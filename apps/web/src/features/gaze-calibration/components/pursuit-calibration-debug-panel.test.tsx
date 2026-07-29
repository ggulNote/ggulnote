import type { RawGazeObservation } from "@ggulnote/gaze-core";
import { InteractionClock, toSessionTimeMs } from "@ggulnote/interaction-core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PursuitCalibrationProfile,
  PursuitCalibrationSnapshot,
  PursuitCalibrationStartResult,
  PursuitViewportUpdateResult,
} from "../application/pursuit-calibration-controller";
import { makeResult, type ViewportRect } from "../domain/calibration-types";
import type { PursuitSampleAcceptanceResult } from "../domain/pursuit-types";
import type { PursuitCalibrationControllerPort } from "../hooks/use-pursuit-calibration";
import { createGazeCalibrationRuntimeContext } from "../runtime/gaze-calibration-runtime-context";
import {
  PursuitCalibrationDebugPanel,
  type PursuitObservationSink,
} from "./pursuit-calibration-debug-panel";

const VIEWPORT_RECT: ViewportRect = { left: 100, top: 50, width: 800, height: 600 };
const CLOCK = new InteractionClock(() => 1_000);
let animationFrames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

beforeEach(() => {
  animationFrames = new Map();
  nextFrameId = 1;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId++;
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

class FakeController implements PursuitCalibrationControllerPort {
  public startCalls = 0;
  public cancelCalls = 0;
  public disposeCalls = 0;
  public pushCalls = 0;
  public viewportUpdates: ViewportRect[] = [];
  private snapshot = createSnapshot();
  private readonly listeners = new Set<(snapshot: PursuitCalibrationSnapshot) => void>();

  public start(): PursuitCalibrationStartResult {
    this.startCalls += 1;
    this.emit({
      sessionId: `session-${this.startCalls}`,
      phase: "preparing",
      role: "calibration",
    });
    return makeResult(this.snapshot);
  }

  public tick(): void {}

  public pushRawGazeObservation(
    _observation: RawGazeObservation,
  ): PursuitSampleAcceptanceResult {
    this.pushCalls += 1;
    return { ok: false, reason: "outside-collection-window" };
  }

  public cancel(): void {
    this.cancelCalls += 1;
    this.emit({ phase: "cancelled", currentTarget: null });
  }

  public dispose(): void {
    this.disposeCalls += 1;
    this.listeners.clear();
  }

  public updateViewportRect(viewportRect: ViewportRect): PursuitViewportUpdateResult {
    this.viewportUpdates.push(viewportRect);
    return makeResult(viewportRect);
  }

  public subscribe(listener: (snapshot: PursuitCalibrationSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
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
    progress: { completedSegments: 0, totalSegments: 12, overallRatio: 0 },
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
    timing: { sessionStartedAtMs: null, phaseStartedAtMs: null },
  };
}

function createProfile(id: string, version: string): PursuitCalibrationProfile {
  return {
    id,
    version,
    mode: "smooth-pursuit",
    createdAtMs: 900,
    viewportBasis: { width: 800, height: 600 },
    model: {
      method: "affine-2d",
      coefficientsX: [0, 1, 0],
      coefficientsY: [0, 0, 1],
      viewportBasis: { width: 800, height: 600 },
      biasCorrection: { x: 0, y: 0 },
      version,
      createdAtMs: 900,
    },
    pursuit: {
      calibrationTrajectoryId: "calibration-v1",
      validationTrajectoryId: "validation-v1",
      lagEstimate: {
        lagMs: 120,
        correlationX: 0.9,
        correlationY: 0.8,
        combinedScore: 0.85,
        pairedSampleCount: 80,
        source: "estimated",
      },
      targetDiameterPx: 56,
      calibrationSampleCount: 80,
      validationSampleCount: 50,
    },
    validation: {
      sampleCount: 50,
      meanResidual: { x: 1, y: -2 },
      rmse: { x: 3, y: 4, radial: 5 },
      meanAbsoluteError: { x: 2, y: 3 },
      maxRadialError: 12,
    },
    residualDistribution: {
      bias: { x: 1, y: -2 },
      covariance: { xx: 9, xy: 1, yy: 4 },
    },
    roiTemplate: {
      coverageProbability: 0.9,
      radiusMajor: 30,
      radiusMinor: 20,
      rotationRad: 0.2,
      covariance: { xx: 9, xy: 1, yy: 4 },
      scaleQuantile: 4.6,
      estimationMethod: "empirical-mahalanobis",
      source: "validation-residuals",
      clampBoundsToViewport: true,
      metrics: {
        requestedCoverage: 0.9,
        empiricalCoverage: 0.92,
        coveredResidualCount: 46,
        totalResidualCount: 50,
        roiAreaPx2: 1884,
        scaleQuantile: 4.6,
        radiusMajor: 30,
        radiusMinor: 20,
        majorRadiusClamped: false,
        minorRadiusClamped: false,
      },
    },
    quality: "valid",
  };
}

function createObservation(): RawGazeObservation {
  return {
    frameId: 3,
    sourceCapturedAt: toSessionTimeMs(10),
    processingStartedAt: toSessionTimeMs(12),
    processingCompletedAt: toSessionTimeMs(15),
    leftDirection: { x: 1, y: 0, z: 0 },
    rightDirection: { x: 1, y: 0, z: 0 },
    rawCombinedDirection: { x: 1, y: 0, z: 0 },
    smoothedCombinedDirection: { x: 1, y: 0, z: 0 },
    head: {
      center: { x: 0, y: 0, z: 0 },
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      faceScale: 1,
    },
    smoothing: {
      sampleCount: 1,
      windowStartedAt: toSessionTimeMs(10),
      windowEndedAt: toSessionTimeMs(10),
    },
    quality: {
      faceDetected: true,
      leftEyeReady: true,
      rightEyeReady: true,
      trackingConfidence: 1,
    },
  };
}

function renderPanel(runtime = createGazeCalibrationRuntimeContext()) {
  const controller = new FakeController();
  let sink: PursuitObservationSink | null = null;
  const onObservationSinkChange = vi.fn((next: PursuitObservationSink | null) => {
    sink = next;
  });
  const view = render(
    <PursuitCalibrationDebugPanel
      clock={CLOCK}
      controllerFactory={() => controller}
      latestTimelineSample={null}
      onObservationSinkChange={onObservationSinkChange}
      runtimeContext={runtime}
      viewportRect={VIEWPORT_RECT}
    />,
  );
  return {
    ...view,
    controller,
    runtime,
    onObservationSinkChange,
    getSink: () => sink,
  };
}

describe("PursuitCalibrationDebugPanel", () => {
  it("starts once and prevents a duplicate start while active", () => {
    const fixture = renderPanel();
    const start = screen.getByRole("button", { name: "Smooth Pursuit Calibration 시작" });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(fixture.controller.startCalls).toBe(1);
    expect(start).toBeDisabled();
  });

  it("cancels an active session, removes the target, and can restart", () => {
    const fixture = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Smooth Pursuit Calibration 시작" }));
    act(() => fixture.controller.emit({
      phase: "direction-cue",
      currentTarget: {
        role: "calibration",
        segmentId: "segment-a",
        segmentIndex: 0,
        segmentCount: 2,
        center: { x: 200, y: 180 },
        bounds: { left: 172, top: 152, right: 228, bottom: 208 },
        movementProgress: 0,
        nextDirection: { x: 1, y: 0 },
        showTarget: true,
        showDirectionCue: true,
        shouldCollectSample: false,
      },
    }));
    expect(screen.getByTestId("pursuit-target")).toBeInTheDocument();
    expect(screen.getByTestId("pursuit-direction-arrow")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Calibration 취소" }));
    expect(fixture.controller.cancelCalls).toBe(1);
    expect(screen.queryByTestId("pursuit-target")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Smooth Pursuit Calibration 시작" }));
    expect(fixture.controller.startCalls).toBe(2);
  });

  it("hides the direction arrow during moving", () => {
    const fixture = renderPanel();
    act(() => fixture.controller.emit({
      phase: "moving",
      currentTarget: {
        role: "calibration",
        segmentId: "segment-a",
        segmentIndex: 0,
        segmentCount: 2,
        center: { x: 200, y: 180 },
        bounds: { left: 172, top: 152, right: 228, bottom: 208 },
        movementProgress: 0.5,
        nextDirection: { x: 1, y: 0 },
        showTarget: true,
        showDirectionCue: false,
        shouldCollectSample: true,
      },
    }));
    expect(screen.getByTestId("pursuit-target")).toBeInTheDocument();
    expect(screen.queryByTestId("pursuit-direction-arrow")).not.toBeInTheDocument();
  });

  it("forwards each valid raw observation through one registered sink", () => {
    const fixture = renderPanel();
    const sink = fixture.getSink();
    if (sink === null) throw new Error("Expected observation sink registration.");
    sink(createObservation());
    expect(fixture.controller.pushCalls).toBe(1);
    expect(fixture.onObservationSinkChange).toHaveBeenCalledTimes(1);
  });

  it("forwards viewport position and size updates", () => {
    const fixture = renderPanel();
    fixture.rerender(
      <PursuitCalibrationDebugPanel
        clock={CLOCK}
        controllerFactory={() => fixture.controller}
        latestTimelineSample={null}
        onObservationSinkChange={fixture.onObservationSinkChange}
        runtimeContext={fixture.runtime}
        viewportRect={{ ...VIEWPORT_RECT, left: 125, top: 80 }}
      />,
    );
    expect(fixture.controller.viewportUpdates.at(-1)).toEqual({
      ...VIEWPORT_RECT,
      left: 125,
      top: 80,
    });
  });

  it("keeps the existing profile while recalibrating or cancelling", () => {
    const runtime = createGazeCalibrationRuntimeContext();
    const profileA = createProfile("profile-a", "v1");
    runtime.setProfile(profileA);
    renderPanel(runtime);
    fireEvent.click(screen.getByRole("button", { name: "Smooth Pursuit Calibration 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "Calibration 취소" }));
    expect(runtime.getSnapshot().profile).toBe(profileA);
  });

  it("activates a completed profile and replaces only the active runtime profile", () => {
    const runtime = createGazeCalibrationRuntimeContext();
    const profileA = createProfile("profile-a", "v1");
    const profileB = createProfile("profile-b", "v2");
    runtime.setProfile(profileA);
    const fixture = renderPanel(runtime);
    act(() => fixture.controller.emit({ phase: "completed", profile: profileB }));
    expect(runtime.getSnapshot().profile).toBe(profileB);
    expect(screen.getByText("profile-b")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
  });

  it("does not replace an existing profile after failure and exposes an accessible error", () => {
    const runtime = createGazeCalibrationRuntimeContext();
    const profileA = createProfile("profile-a", "v1");
    runtime.setProfile(profileA);
    const fixture = renderPanel(runtime);
    act(() => fixture.controller.emit({
      phase: "failed",
      profile: null,
      error: { code: "viewport-changed", message: "basis changed" },
    }));
    expect(runtime.getSnapshot().profile).toBe(profileA);
    expect(screen.getByRole("alert")).toHaveTextContent("viewport-changed");
    expect(screen.getByRole("alert")).toHaveTextContent("PDF 영역 크기가 변경");
  });

  it("removes an active profile only through the explicit button", () => {
    const runtime = createGazeCalibrationRuntimeContext();
    runtime.setProfile(createProfile("profile-a", "v1"));
    renderPanel(runtime);
    fireEvent.click(screen.getByRole("button", { name: "활성 Profile 제거" }));
    expect(runtime.getSnapshot().profile).toBeNull();
  });

  it("keeps a fixed-grid fallback entry point", () => {
    const onFallback = vi.fn();
    const controller = new FakeController();
    render(
      <PursuitCalibrationDebugPanel
        clock={CLOCK}
        controllerFactory={() => controller}
        latestTimelineSample={null}
        onObservationSinkChange={() => undefined}
        onRequestFixedGridFallback={onFallback}
        runtimeContext={createGazeCalibrationRuntimeContext()}
        viewportRect={VIEWPORT_RECT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fixed-grid Fallback" }));
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("cleans the observation sink and controller on unmount", async () => {
    const fixture = renderPanel();
    fixture.unmount();
    expect(fixture.onObservationSinkChange).toHaveBeenLastCalledWith(null);
    await Promise.resolve();
    expect(fixture.controller.disposeCalls).toBe(1);
  });
});

describe("GazeCalibrationRuntimeContext", () => {
  it("updates stable snapshots and suppresses duplicate viewport notifications", () => {
    const runtime = createGazeCalibrationRuntimeContext();
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.setPdfViewportRect(VIEWPORT_RECT);
    runtime.setPdfViewportRect({ ...VIEWPORT_RECT });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(runtime.getCalibrationContext().pdfViewportRect).toEqual(VIEWPORT_RECT);
  });
});
