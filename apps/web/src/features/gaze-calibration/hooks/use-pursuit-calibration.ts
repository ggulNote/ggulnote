"use client";

import type { RawGazeObservation } from "@ggulnote/gaze-core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  PursuitCalibrationController,
  type PursuitCalibrationControllerDependencies,
  type PursuitCalibrationError,
  type PursuitCalibrationProfile,
  type PursuitCalibrationSnapshot,
  type PursuitCalibrationStartResult,
  type PursuitViewportUpdateResult,
} from "../application/pursuit-calibration-controller";
import { makeError, type ViewportRect } from "../domain/calibration-types";
import type { PursuitSampleAcceptanceResult } from "../domain/pursuit-types";

export type PursuitCalibrationControllerPort = Pick<
  PursuitCalibrationController,
  | "start"
  | "tick"
  | "pushRawGazeObservation"
  | "cancel"
  | "dispose"
  | "updateViewportRect"
  | "subscribe"
  | "getSnapshot"
>;

export type PursuitCalibrationControllerFactory = (
  dependencies: PursuitCalibrationControllerDependencies,
) => PursuitCalibrationControllerPort;

export type UsePursuitCalibrationOptions = Readonly<{
  readonly dependencies: PursuitCalibrationControllerDependencies;
  readonly autoStart?: boolean;
  readonly onCompleted?: (profile: PursuitCalibrationProfile) => void;
  readonly onFailed?: (error: PursuitCalibrationError) => void;
  /**
   * Test/integration seam. The selected factory and all session dependencies are
   * fixed for the lifetime of this hook mount.
   */
  readonly controllerFactory?: PursuitCalibrationControllerFactory;
}>;

export type UsePursuitCalibrationResult = Readonly<{
  readonly snapshot: PursuitCalibrationSnapshot;
  readonly start: () => PursuitCalibrationStartResult;
  readonly cancel: () => void;
  readonly pushRawGazeObservation: (
    observation: RawGazeObservation,
  ) => PursuitSampleAcceptanceResult;
  readonly updateViewportRect: (
    viewportRect: ViewportRect,
  ) => PursuitViewportUpdateResult;
  readonly isActive: boolean;
  readonly isCompleted: boolean;
  readonly isFailed: boolean;
}>;

type StoreListener = () => void;

type PursuitCalibrationExternalStore = Readonly<{
  readonly attach: (controller: PursuitCalibrationControllerPort) => void;
  readonly pause: () => void;
  readonly dispose: () => void;
  readonly getController: () => PursuitCalibrationControllerPort | null;
  readonly getSnapshot: () => PursuitCalibrationSnapshot;
  readonly isDisposed: () => boolean;
  readonly subscribe: (listener: StoreListener) => () => void;
}>;

export function createPursuitCalibrationController(
  dependencies: PursuitCalibrationControllerDependencies,
): PursuitCalibrationControllerPort {
  return new PursuitCalibrationController(dependencies);
}

export function usePursuitCalibration({
  dependencies,
  autoStart = false,
  onCompleted,
  onFailed,
  controllerFactory = createPursuitCalibrationController,
}: UsePursuitCalibrationOptions): UsePursuitCalibrationResult {
  const [store] = useState(createPursuitCalibrationExternalStore);
  const dependenciesRef = useRef(dependencies);
  const controllerFactoryRef = useRef(controllerFactory);
  const autoStartRef = useRef(autoStart);
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const autoStartedControllerRef = useRef<PursuitCalibrationControllerPort | null>(null);
  const deliveredProfileRef = useRef<PursuitCalibrationProfile | null>(null);
  const deliveredErrorRef = useRef<PursuitCalibrationError | null>(null);
  const onCompletedRef = useRef(onCompleted);
  const onFailedRef = useRef(onFailed);

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  const stopAnimationFrame = useCallback((): void => {
    if (animationFrameRef.current === null) {
      return;
    }
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;

    const controller = store.getController()
      ?? controllerFactoryRef.current(dependenciesRef.current);
    store.attach(controller);

    if (
      autoStartRef.current
      && autoStartedControllerRef.current !== controller
      && controller.getSnapshot().phase === "idle"
    ) {
      autoStartedControllerRef.current = controller;
      controller.start();
    }

    return () => {
      mountedRef.current = false;
      stopAnimationFrame();
      store.pause();
      lifecycleGenerationRef.current += 1;
      const cleanupGeneration = lifecycleGenerationRef.current;

      // React Strict Mode immediately replays effects. Deferring disposal by one
      // microtask preserves the single controller during that replay while still
      // disposing it after a real unmount.
      queueMicrotask(() => {
        if (
          !mountedRef.current
          && lifecycleGenerationRef.current === cleanupGeneration
        ) {
          store.dispose();
        }
      });
    };
  }, [stopAnimationFrame, store]);

  useEffect(() => {
    if (!isActivePursuitPhase(snapshot.phase)) {
      stopAnimationFrame();
      return;
    }

    let stopped = false;
    const runFrame = (): void => {
      animationFrameRef.current = null;
      if (stopped || !mountedRef.current) {
        return;
      }
      const controller = store.getController();
      if (controller === null) {
        return;
      }
      controller.tick();
      if (
        !stopped
        && mountedRef.current
        && isActivePursuitPhase(store.getSnapshot().phase)
      ) {
        animationFrameRef.current = requestAnimationFrame(runFrame);
      }
    };

    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(runFrame);
    }

    return () => {
      stopped = true;
      stopAnimationFrame();
    };
  }, [snapshot.phase, stopAnimationFrame, store]);

  useEffect(() => {
    if (
      snapshot.phase === "completed"
      && snapshot.profile !== null
      && deliveredProfileRef.current !== snapshot.profile
    ) {
      deliveredProfileRef.current = snapshot.profile;
      onCompletedRef.current?.(snapshot.profile);
    }
  }, [snapshot.phase, snapshot.profile]);

  useEffect(() => {
    if (
      snapshot.phase === "failed"
      && snapshot.error !== null
      && deliveredErrorRef.current !== snapshot.error
    ) {
      deliveredErrorRef.current = snapshot.error;
      onFailedRef.current?.(snapshot.error);
    }
  }, [snapshot.error, snapshot.phase]);

  const start = useCallback((): PursuitCalibrationStartResult => {
    const controller = store.getController();
    if (controller === null || !mountedRef.current) {
      const code = store.isDisposed() ? "disposed" : "invalid-state-transition";
      return makeError(code, "The pursuit calibration controller is not available.");
    }
    return controller.start();
  }, [store]);

  const cancel = useCallback((): void => {
    if (!mountedRef.current) {
      return;
    }
    store.getController()?.cancel();
  }, [store]);

  const pushRawGazeObservation = useCallback((
    observation: RawGazeObservation,
  ): PursuitSampleAcceptanceResult => {
    if (!mountedRef.current) {
      return { ok: false, reason: "collector-inactive" };
    }
    const controller = store.getController();
    return controller === null
      ? { ok: false, reason: "collector-inactive" }
      : controller.pushRawGazeObservation(observation);
  }, [store]);

  const updateViewportRect = useCallback((
    viewportRect: ViewportRect,
  ): PursuitViewportUpdateResult => {
    const controller = store.getController();
    if (controller === null || !mountedRef.current) {
      return makeError("disposed", "The pursuit calibration controller is not available.");
    }
    return controller.updateViewportRect(viewportRect);
  }, [store]);

  return {
    snapshot,
    start,
    cancel,
    pushRawGazeObservation,
    updateViewportRect,
    isActive: isActivePursuitPhase(snapshot.phase),
    isCompleted: snapshot.phase === "completed",
    isFailed: snapshot.phase === "failed",
  };
}

function createPursuitCalibrationExternalStore(): PursuitCalibrationExternalStore {
  let controller: PursuitCalibrationControllerPort | null = null;
  let unsubscribeController: (() => void) | null = null;
  let disposed = false;
  let snapshot = createIdleSnapshot();
  const listeners = new Set<StoreListener>();

  const publish = (nextSnapshot: PursuitCalibrationSnapshot): void => {
    snapshot = nextSnapshot;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    attach(nextController) {
      if (disposed) {
        return;
      }
      if (controller !== null && controller !== nextController) {
        throw new Error("A pursuit calibration controller is already attached.");
      }
      controller = nextController;
      unsubscribeController?.();
      unsubscribeController = controller.subscribe(publish);
    },
    pause() {
      unsubscribeController?.();
      unsubscribeController = null;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeController?.();
      unsubscribeController = null;
      controller?.dispose();
      controller = null;
      listeners.clear();
    },
    getController() {
      return controller;
    },
    getSnapshot() {
      return snapshot;
    },
    isDisposed() {
      return disposed;
    },
    subscribe(listener) {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function createIdleSnapshot(): PursuitCalibrationSnapshot {
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

function isActivePursuitPhase(
  phase: PursuitCalibrationSnapshot["phase"],
): boolean {
  return phase !== "idle"
    && phase !== "completed"
    && phase !== "failed"
    && phase !== "cancelled";
}
