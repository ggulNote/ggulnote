"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { InteractionClock } from "@ggulnote/interaction-core";
import {
  FaceLandmarkDebugPanel,
  FaceTrackingSession,
  drawLandmarkOverlay,
  GazeCameraPreview,
  resolveFaceLandmarkerModelUrl,
  resolveMediapipeWasmRoot,
  type FaceTrackingSessionStats,
} from "@/features/gaze";

const initialStats: FaceTrackingSessionStats = {
  status: "idle",
  frameId: 0,
  faceDetected: false,
  landmarkCount: 0,
  sourceCapturedAt: null,
  processingStartedAt: null,
  processingCompletedAt: null,
  processingLatencyMs: null,
  inferenceDurationMs: null,
  gazeComputationDurationMs: null,
  totalWorkerDurationMs: null,
  droppedFrameCount: 0,
  fps: 0,
  lastError: null,
  frameWidth: null,
  frameHeight: null,
  trackingConfidence: null,
  rawGazeStatus: null,
  rawGazeMessage: null,
  leftDirection: null,
  rightDirection: null,
  rawCombinedDirection: null,
  smoothedCombinedDirection: null,
  eyeSphereLeft: null,
  eyeSphereRight: null,
  sampleCount: null,
  eyeGeometryInitialized: false,
  eyeGeometryInitializedAt: null,
  eyeGeometryInitializedFromFrameId: null,
};

export default function DebugGazePage(): React.ReactElement {
  const clockRef = useRef<InteractionClock | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<FaceTrackingSession | null>(null);
  const statsRef = useRef(initialStats);
  const [stats, setStats] = useState(initialStats);
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializingEyeGeometry, setIsInitializingEyeGeometry] = useState(false);
  const [isResettingEyeGeometry, setIsResettingEyeGeometry] = useState(false);

  useEffect(() => {
    clockRef.current = new InteractionClock(() => performance.now());
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStats(statsRef.current);
    }, 200);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;

    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
      drawLandmarkOverlay(overlayCanvas, null);
      setIsRunning(false);
      setIsInitializingEyeGeometry(false);
      setIsResettingEyeGeometry(false);
    };
  }, []);

  const ensureSession = (): FaceTrackingSession => {
    if (!videoRef.current) {
      throw new Error("비디오 태그가 준비되지 않았습니다.");
    }

    if (!clockRef.current) {
      throw new Error("InteractionClock가 초기화되지 않았습니다.");
    }

    if (!sessionRef.current) {
      sessionRef.current = new FaceTrackingSession(
        videoRef.current,
        {
          clock: clockRef.current,
          modelUrl: resolveFaceLandmarkerModelUrl(),
          wasmRoot: resolveMediapipeWasmRoot(),
        },
        {
          onStatsChange: (next) => {
            statsRef.current = next;
            setIsRunning(
              next.status === "running" ||
                next.status === "loading-model" ||
                next.status === "requesting-camera",
            );
          },
          onLandmarkFrame: (frame) => {
            drawLandmarkOverlay(overlayCanvasRef.current, frame);
          },
          onNoFace: () => {
            drawLandmarkOverlay(overlayCanvasRef.current, null);
          },
          onError: () => {
            drawLandmarkOverlay(overlayCanvasRef.current, null);
          },
        },
      );
    }

    return sessionRef.current;
  };

  const start = async () => {
    const session = ensureSession();
    try {
      await session.start();
    } catch {
      // Errors are reflected through session stats callback.
    }
  };

  const stop = () => {
    sessionRef.current?.stop();
    setIsRunning(false);
  };

  const initializeEyeGeometry = async () => {
    const session = ensureSession();
    if (isInitializingEyeGeometry) {
      return;
    }

    try {
      setIsInitializingEyeGeometry(true);
      await session.initializeEyeGeometry();
    } catch {
      // reflected as errors in stats
    } finally {
      setIsInitializingEyeGeometry(false);
    }
  };

  const resetEyeGeometry = async () => {
    const session = ensureSession();
    if (isResettingEyeGeometry) {
      return;
    }

    try {
      setIsResettingEyeGeometry(true);
      await session.resetEyeGeometry();
    } catch {
      // ignore
    } finally {
      setIsResettingEyeGeometry(false);
    }
  };

  const canControlGeometry =
    stats.status === "running" ||
    stats.status === "loading-model" ||
    stats.status === "requesting-camera";
  const isGeometryBusy = isInitializingEyeGeometry || isResettingEyeGeometry;

  const eyeGeometryButtonLabel = isInitializingEyeGeometry
    ? "Initializing Eye Geometry…"
    : stats.eyeGeometryInitialized
      ? "Re-Initialize Eye Geometry"
      : "Initialize Eye Geometry";

  const resetButtonLabel = isResettingEyeGeometry ? "Resetting Eye Geometry…" : "Reset Eye Geometry";

  const initializeButtonClass =
    `rounded-md border px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
      isInitializingEyeGeometry
        ? "border-sky-900 bg-sky-900 text-white"
        : stats.eyeGeometryInitialized
          ? "border-emerald-700 bg-emerald-100 text-emerald-800"
          : "border-sky-700 bg-white text-sky-700"
    }`;

  const resetButtonClass =
    `rounded-md border border-amber-700 px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
      isResettingEyeGeometry ? "bg-amber-900 text-white" : "bg-white text-amber-700"
    }`;

  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Face Landmark Debug</h1>
          <p className="mt-1 text-sm text-slate-600">
            Raw gaze 계산을 연결하려면 먼저 정면 중앙을 보면서 <strong>Initialize Eye Geometry</strong>를 실행하세요.
          </p>
        </div>
        <Link
          href="/debug"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          /debug
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.8fr_1fr]">
        <GazeCameraPreview videoRef={videoRef} overlayCanvasRef={overlayCanvasRef} />
        <FaceLandmarkDebugPanel stats={stats} />
      </div>

      <section className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            void start();
          }}
          disabled={isRunning}
          className={`rounded-md border border-slate-900 px-4 py-2 font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 ${
            isRunning ? "bg-white" : "bg-slate-900 text-white"
          }`}
        >
          {isRunning ? "Running…" : "Start Camera"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!isRunning}
          className="rounded-md border border-red-500 bg-white px-4 py-2 font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-60 hover:bg-red-50"
        >
          Stop Camera
        </button>
        <button
          type="button"
          onClick={() => {
            void initializeEyeGeometry();
          }}
          disabled={!canControlGeometry || isGeometryBusy}
          className={initializeButtonClass}
        >
          {eyeGeometryButtonLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            void resetEyeGeometry();
          }}
          disabled={!isRunning || !stats.eyeGeometryInitialized || isGeometryBusy}
          className={resetButtonClass}
        >
          {resetButtonLabel}
        </button>
      </section>

      <section className="mt-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Eye Geometry Control</p>
        <p className="mt-1">
          상태: <span className={stats.eyeGeometryInitialized ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{
            stats.eyeGeometryInitialized ? "Initialized" : "Not Initialized"
          }</span>
        </p>
        {stats.eyeGeometryInitialized && (
          <p className="mt-1 text-slate-600">
            마지막 초기화: frame#{stats.eyeGeometryInitializedFromFrameId ?? "-"} / {stats.eyeGeometryInitializedAt ?? "-"}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          {isGeometryBusy
            ? "Eye Geometry 명령 처리 중입니다."
            : stats.rawGazeStatus === "eye-geometry-required"
              ? "Eye Geometry가 필요합니다. Initialize Eye Geometry를 눌러주세요."
              : stats.rawGazeStatus === "tracking"
                ? "현재 Eye Geometry가 활성화되어 실시간 추적 중입니다."
                : "Eye Geometry 상태를 확인하세요."}
        </p>
      </section>
    </main>
  );
}
