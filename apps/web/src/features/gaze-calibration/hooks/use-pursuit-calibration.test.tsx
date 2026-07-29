import type { RawGazeObservation } from "@ggulnote/gaze-core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PursuitCalibrationControllerDependencies,
  PursuitCalibrationError,
  PursuitCalibrationProfile,
  PursuitCalibrationSnapshot,
  PursuitCalibrationStartResult,
  PursuitViewportUpdateResult,
} from "../application/pursuit-calibration-controller";
import { makeResult, type ViewportRect } from "../domain/calibration-types";
import type { PursuitSampleAcceptanceResult } from "../domain/pursuit-types";
import {
  usePursuitCalibration,
  type PursuitCalibrationControllerPort,
  type UsePursuitCalibrationOptions,
} from "./use-pursuit-calibration";

const DEPENDENCIES = {} as PursuitCalibrationControllerDependencies;
const OBSERVATION = {} as RawGazeObservation;
const VIEWPORT_RECT: ViewportRect = {
  left: 10,
  top: 20,
  width: 800,
  height: 600,
};

let animationFrames: Map<number, FrameRequestCallback>;
let nextAnimationFrameId: number;

beforeEach(() => {
  animationFrames = new Map();
  nextAnimationFrameId = 1;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    animationFrames.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
    animationFrames.delete(id);
  }));
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.unstubAllGlobals();
});

class FakePursuitController implements PursuitCalibrationControllerPort {
  public startCalls = 0;
  public tickCalls = 0;
  public cancelCalls = 0;
  public disposeCalls = 0;
  public pushCalls = 0;
  public viewportUpdateCalls = 0;
  public subscribeCalls = 0;
  public unsubscribeCalls = 0;
  public lastObservation: RawGazeObservation | null = null;
  public lastViewportRect: ViewportRect | null = null;
  private snapshot = createSnapshot();
  private readonly listeners = new Set<(snapshot: PursuitCalibrationSnapshot) => void>();

  public start(): PursuitCalibrationStartResult {
    this.startCalls += 1;
    this.emit({ phase: "preparing" });
    return makeResult(this.snapshot);
  }

  public tick(): void {
    this.tickCalls += 1;
  }

  public pushRawGazeObservation(
    observation: RawGazeObservation,
  ): PursuitSampleAcceptanceResult {
    this.pushCalls += 1;
    this.lastObservation = observation;
    return { ok: false, reason: "outside-collection-window" };
  }

  public cancel(): void {
    this.cancelCalls += 1;
    this.emit({ phase: "cancelled" });
  }

  public dispose(): void {
    this.disposeCalls += 1;
    this.listeners.clear();
  }

  public updateViewportRect(viewportRect: ViewportRect): PursuitViewportUpdateResult {
    this.viewportUpdateCalls += 1;
    this.lastViewportRect = viewportRect;
    return makeResult(viewportRect);
  }

  public subscribe(
    listener: (snapshot: PursuitCalibrationSnapshot) => void,
  ): () => void {
    this.subscribeCalls += 1;
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.unsubscribeCalls += 1;
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): PursuitCalibrationSnapshot {
    return this.snapshot;
  }

  public emit(patch: Partial<PursuitCalibrationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

function createSnapshot(): PursuitCalibrationSnapshot {
  return {
    sessionId: null,
    phase: "idle",
    role: null,
    currentTarget: null,
    progress: {
      completedSegments: 0,
      totalSegments: 0,
      overallRatio: 0,
    },
    collection: {
      calibrationAcceptedCount: 0,
      validationAcceptedCount: 0,
      rejectedCount: 0,
      rejectionCounts: {},
    },
    lagEstimate: null,
    affineModelAvailable: false,
    profile: null,
    error: null,
    timing: {
      sessionStartedAtMs: null,
      phaseStartedAtMs: null,
    },
  };
}

function renderCalibrationHook(
  options: Partial<Omit<UsePursuitCalibrationOptions, "dependencies" | "controllerFactory">> = {},
) {
  const controller = new FakePursuitController();
  let factoryCalls = 0;
  const hook = renderHook(() => usePursuitCalibration({
    dependencies: DEPENDENCIES,
    controllerFactory: () => {
      factoryCalls += 1;
      return controller;
    },
    ...options,
  }));
  return {
    ...hook,
    controller,
    getFactoryCalls: () => factoryCalls,
  };
}

function flushAnimationFrame(): void {
  const entry = animationFrames.entries().next().value;
  if (entry === undefined) {
    throw new Error("No requestAnimationFrame callback is pending.");
  }
  const [id, callback] = entry;
  animationFrames.delete(id);
  act(() => callback(16));
}

function StrictWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

describe("usePursuitCalibration", () => {
  it("creates one controller for a mounted hook", () => {
    const fixture = renderCalibrationHook();
    expect(fixture.getFactoryCalls()).toBe(1);
    expect(fixture.controller.subscribeCalls).toBe(1);
  });

  it("subscribes to controller snapshots and updates the result", () => {
    const fixture = renderCalibrationHook();
    act(() => {
      fixture.controller.emit({ sessionId: "session-1", phase: "initial-hold" });
    });
    expect(fixture.result.current.snapshot).toMatchObject({
      sessionId: "session-1",
      phase: "initial-hold",
    });
  });

  it("forwards start and exposes active state", () => {
    const fixture = renderCalibrationHook();
    const startResults: PursuitCalibrationStartResult[] = [];
    act(() => {
      startResults.push(fixture.result.current.start());
    });
    expect(startResults).toHaveLength(1);
    expect(startResults[0].ok).toBe(true);
    expect(fixture.controller.startCalls).toBe(1);
    expect(fixture.result.current.isActive).toBe(true);
  });

  it("forwards cancel", () => {
    const fixture = renderCalibrationHook();
    act(() => {
      fixture.result.current.start();
      fixture.result.current.cancel();
    });
    expect(fixture.controller.cancelCalls).toBe(1);
    expect(fixture.result.current.snapshot.phase).toBe("cancelled");
  });

  it("forwards raw observations without reclassifying them", () => {
    const fixture = renderCalibrationHook();
    const result = fixture.result.current.pushRawGazeObservation(OBSERVATION);
    expect(result).toEqual({ ok: false, reason: "outside-collection-window" });
    expect(fixture.controller.lastObservation).toBe(OBSERVATION);
    expect(fixture.controller.pushCalls).toBe(1);
  });

  it("forwards viewport updates", () => {
    const fixture = renderCalibrationHook();
    const result = fixture.result.current.updateViewportRect(VIEWPORT_RECT);
    expect(result).toEqual(makeResult(VIEWPORT_RECT));
    expect(fixture.controller.lastViewportRect).toBe(VIEWPORT_RECT);
    expect(fixture.controller.viewportUpdateCalls).toBe(1);
  });

  it("starts one RAF loop while the controller is active", () => {
    const fixture = renderCalibrationHook();
    act(() => fixture.controller.emit({ phase: "moving" }));
    expect(animationFrames.size).toBe(1);
  });

  it("ticks once per RAF frame and schedules the next frame", () => {
    const fixture = renderCalibrationHook();
    act(() => fixture.controller.emit({ phase: "moving" }));
    flushAnimationFrame();
    expect(fixture.controller.tickCalls).toBe(1);
    expect(animationFrames.size).toBe(1);
  });

  it("stops the RAF loop in terminal phases", () => {
    const fixture = renderCalibrationHook();
    act(() => fixture.controller.emit({ phase: "moving" }));
    act(() => fixture.controller.emit({ phase: "completed" }));
    expect(animationFrames.size).toBe(0);
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("clears the RAF loop when cancel is called", () => {
    const fixture = renderCalibrationHook();
    act(() => fixture.result.current.start());
    expect(animationFrames.size).toBe(1);
    act(() => fixture.result.current.cancel());
    expect(animationFrames.size).toBe(0);
  });

  it("clears RAF and disposes the controller after unmount", async () => {
    const fixture = renderCalibrationHook();
    act(() => fixture.controller.emit({ phase: "moving" }));
    fixture.unmount();
    expect(animationFrames.size).toBe(0);
    await Promise.resolve();
    expect(fixture.controller.disposeCalls).toBe(1);
  });

  it("does not duplicate controller creation or RAF in Strict Mode", () => {
    const controller = new FakePursuitController();
    let factoryCalls = 0;
    renderHook(() => usePursuitCalibration({
      dependencies: DEPENDENCIES,
      autoStart: true,
      controllerFactory: () => {
        factoryCalls += 1;
        return controller;
      },
    }), { wrapper: StrictWrapper });
    expect(factoryCalls).toBe(1);
    expect(controller.startCalls).toBe(1);
    expect(animationFrames.size).toBe(1);
  });

  it("does not auto-start by default", () => {
    const fixture = renderCalibrationHook();
    expect(fixture.controller.startCalls).toBe(0);
    expect(fixture.result.current.snapshot.phase).toBe("idle");
  });

  it("auto-starts exactly once per mount", () => {
    const fixture = renderCalibrationHook({ autoStart: true });
    expect(fixture.controller.startCalls).toBe(1);
    expect(fixture.result.current.snapshot.phase).toBe("preparing");
  });

  it("calls onCompleted once for the same profile", () => {
    const profile = {} as PursuitCalibrationProfile;
    const onCompleted = vi.fn();
    const fixture = renderCalibrationHook({ onCompleted });
    act(() => fixture.controller.emit({ phase: "completed", profile }));
    act(() => fixture.controller.emit({
      timing: { sessionStartedAtMs: 0, phaseStartedAtMs: 10 },
    }));
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith(profile);
  });

  it("calls onFailed once for the same error", () => {
    const error: PursuitCalibrationError = {
      code: "validation-failed",
      message: "validation failed",
    };
    const onFailed = vi.fn();
    const fixture = renderCalibrationHook({ onFailed });
    act(() => fixture.controller.emit({ phase: "failed", error }));
    act(() => fixture.controller.emit({
      timing: { sessionStartedAtMs: 0, phaseStartedAtMs: 10 },
    }));
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith(error);
  });

  it("does not replay a completed result when callback identity changes", () => {
    const profile = {} as PursuitCalibrationProfile;
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const controller = new FakePursuitController();
    const { rerender } = renderHook(
      ({ onCompleted }: { onCompleted: (value: PursuitCalibrationProfile) => void }) =>
        usePursuitCalibration({
          dependencies: DEPENDENCIES,
          controllerFactory: () => controller,
          onCompleted,
        }),
      { initialProps: { onCompleted: firstCallback } },
    );
    act(() => controller.emit({ phase: "completed", profile }));
    rerender({ onCompleted: secondCallback });
    act(() => controller.emit({
      collection: {
        calibrationAcceptedCount: 1,
        validationAcceptedCount: 1,
        rejectedCount: 0,
        rejectionCounts: {},
      },
    }));
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).not.toHaveBeenCalled();
  });

  it("rejects stale observations after unmount without calling the controller", async () => {
    const fixture = renderCalibrationHook();
    const push = fixture.result.current.pushRawGazeObservation;
    fixture.unmount();
    await Promise.resolve();
    expect(push(OBSERVATION)).toEqual({
      ok: false,
      reason: "collector-inactive",
    });
    expect(fixture.controller.pushCalls).toBe(0);
  });

  it("cleans up the controller subscription on unmount", () => {
    const fixture = renderCalibrationHook();
    fixture.unmount();
    expect(fixture.controller.unsubscribeCalls).toBe(1);
  });

  it("exposes completed, failed, profile, and error state", () => {
    const profile = {} as PursuitCalibrationProfile;
    const error: PursuitCalibrationError = {
      code: "confidence-roi-failed",
      message: "roi failed",
    };
    const fixture = renderCalibrationHook();
    act(() => fixture.controller.emit({ phase: "completed", profile }));
    expect(fixture.result.current.isCompleted).toBe(true);
    expect(fixture.result.current.snapshot.profile).toBe(profile);
    act(() => fixture.controller.emit({ phase: "failed", error, profile: null }));
    expect(fixture.result.current.isFailed).toBe(true);
    expect(fixture.result.current.snapshot.error).toBe(error);
  });
});
