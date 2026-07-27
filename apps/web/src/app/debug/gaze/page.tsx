"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  toSessionTimeMs,
  type SessionTimeMs,
  type TimedGazeSample,
} from "@ggulnote/interaction-core";
import {
  BrowserInteractionSession,
  type BrowserInteractionSessionSnapshot,
  GAZE_TIMELINE_RETENTION_MS,
} from "@/features/interaction";
import {
  FaceLandmarkDebugPanel,
  GazeCameraPreview,
  drawLandmarkOverlay,
  resolveFaceLandmarkerModelUrl,
  resolveMediapipeWasmRoot,
  type FaceTrackingSessionStats,
} from "@/features/gaze";
import type { FaceLandmarkFrame } from "@ggulnote/gaze-core";
const emptyTimelineSnapshot: BrowserInteractionSessionSnapshot = {
  status: "idle",
  sessionTime: toSessionTimeMs(0),
  timelineRetentionMs: GAZE_TIMELINE_RETENTION_MS,
  timelineSize: 0,
  oldestSampleSourceCapturedAt: null,
  newestSampleSourceCapturedAt: null,
  lastStoredFrameId: null,
  lastStoredSourceCapturedAt: null,
  lastStoredProcessingCompletedAt: null,
  lastEndToEndLatencyMs: null,
  recentOneSecondSampleCount: 0,
  duplicateFrameCount: 0,
};
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
const toTimeText = (value: SessionTimeMs | number | null): string => {
  if (value === null) {
    return "-";
  }
  return `${Math.round(value)}`;
};
const toDurationText = (value: number | null): string => {
  if (value === null) {
    return "-";
  }
  return `${Math.round(value)} ms`;
};
function getVectorOverlayData(
  sample: TimedGazeSample | null,
  stats: FaceTrackingSessionStats,
): {
  leftDirection: TimedGazeSample["observation"]["leftDirection"];
  rightDirection: TimedGazeSample["observation"]["rightDirection"];
  rawCombinedDirection: TimedGazeSample["observation"]["rawCombinedDirection"];
  smoothedCombinedDirection: TimedGazeSample["observation"]["smoothedCombinedDirection"];
  head: TimedGazeSample["observation"]["head"];
  leftEyeSphere: FaceLandmarkFrame["landmarks"][number] | null;
  rightEyeSphere: FaceLandmarkFrame["landmarks"][number] | null;
} | undefined {
  if (!sample) {
    return undefined;
  }

  return {
    leftDirection: sample.observation.leftDirection,
    rightDirection: sample.observation.rightDirection,
    rawCombinedDirection: sample.observation.rawCombinedDirection,
    smoothedCombinedDirection: sample.observation.smoothedCombinedDirection,
    head: sample.observation.head,
    leftEyeSphere: stats.eyeSphereLeft,
    rightEyeSphere: stats.eyeSphereRight,
  };
}
export default function DebugGazePage(): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<BrowserInteractionSession | null>(null);
  const latestLandmarkFrameRef = useRef<FaceLandmarkFrame | null>(null);
  const latestRawSampleRef = useRef<TimedGazeSample | null>(null);
  const statsRef = useRef<FaceTrackingSessionStats>(initialStats);
  const [stats, setStats] = useState<FaceTrackingSessionStats>(initialStats);
  const [timelineState, setTimelineState] = useState<BrowserInteractionSessionSnapshot>(emptyTimelineSnapshot);
  const [recentCount, setRecentCount] = useState(0);
  const [recentWindow, setRecentWindow] = useState({
    startAt: "-",
    endAt: "-",
    firstAt: "-",
    lastAt: "-",
  });
  const [isInitializingEyeGeometry, setIsInitializingEyeGeometry] = useState(false);
  const [isResettingEyeGeometry, setIsResettingEyeGeometry] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setStats(statsRef.current);
      if (sessionRef.current) {
        setTimelineState(sessionRef.current.getState());
      }
    }, 200);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
      latestLandmarkFrameRef.current = null;
      latestRawSampleRef.current = null;
      drawLandmarkOverlay(overlayCanvas, null);
    };
  }, []);
  const redrawOverlay = () => {
    const frame = latestLandmarkFrameRef.current;
    const sample = latestRawSampleRef.current;
    if (!frame) {
      drawLandmarkOverlay(overlayCanvasRef.current, null);
      return;
    }
    drawLandmarkOverlay(overlayCanvasRef.current, frame, sample ? getVectorOverlayData(sample, statsRef.current) : undefined);
  };
  const ensureSession = (): BrowserInteractionSession => {
    if (!videoRef.current) {
      throw new Error("비디오 태그가 준비되지 않았습니다.");
    }
    if (!sessionRef.current) {
      sessionRef.current = new BrowserInteractionSession(
        {
          onTrackingStatsChange: (next) => {
            statsRef.current = next;
          },
          onLandmarkFrame: (frame) => {
            latestLandmarkFrameRef.current = frame;
            redrawOverlay();
          },
          onNoFace: () => {
            latestLandmarkFrameRef.current = null;
            drawLandmarkOverlay(overlayCanvasRef.current, null);
          },
          onError: () => {
            drawLandmarkOverlay(overlayCanvasRef.current, null);
          },
          onTimelineChange: (state) => {
            setTimelineState(state);
          },
          onRawGazeSample: (sample) => {
            latestRawSampleRef.current = sample;
            redrawOverlay();
          },
        },
        {
          video: videoRef.current,
          modelUrl: resolveFaceLandmarkerModelUrl(),
          wasmRoot: resolveMediapipeWasmRoot(),
          timelineRetentionMs: GAZE_TIMELINE_RETENTION_MS,
          timeProvider: () => performance.now(),
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
      // errors are exposed via stats
    }
  };
  const stop = () => {
    sessionRef.current?.stop();
  };
  const clearTimeline = () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    session.clear();
    setTimelineState(session.getState());
    setRecentCount(0);
    setRecentWindow({
      startAt: "-",
      endAt: "-",
      firstAt: "-",
      lastAt: "-",
    });
  };
  const queryRecentWindow = () => {
    const session = ensureSession();
    const samples = session.queryRecentGaze(1_000);
    setRecentCount(samples.length);
    if (samples.length === 0) {
      setRecentWindow({
        startAt: "-",
        endAt: "-",
        firstAt: "-",
        lastAt: "-",
      });
      return;
    }
    setRecentWindow({
      startAt: `${Number(samples[0].time)}`,
      endAt: `${Number(samples[samples.length - 1].time)}`,
      firstAt: `${samples[0].observation.frameId}`,
      lastAt: `${samples[samples.length - 1].observation.frameId}`,
    });
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
  const isRunning = timelineState.status === "running";
  const canControlGeometry =
    isRunning || stats.status === "running" || stats.status === "loading-model" || stats.status === "requesting-camera";
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
          <p className="mt-1 text-xs text-slate-500">
            눈동자 RawGaze 결과는 <strong>Interaction Timeline</strong>에
            <strong> sourceCapturedAt</strong>으로 저장됩니다.
          </p>
        </div>
        <Link
          href="/debug"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          /debug로 이동
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.8fr_1fr]">
        <GazeCameraPreview videoRef={videoRef} overlayCanvasRef={overlayCanvasRef} />
        <FaceLandmarkDebugPanel stats={stats} />
      </div>
      <section className="mt-4 rounded-md border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Interaction Timeline</h2>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="font-semibold">Session 상태</dt>
            <dd>{timelineState.status}</dd>
          </div>
          <div>
            <dt className="font-semibold">현재 Session Time</dt>
            <dd>{toTimeText(timelineState.sessionTime)}</dd>
          </div>
          <div>
            <dt className="font-semibold">Timeline 유지시간</dt>
            <dd>{toTimeText(timelineState.timelineRetentionMs)}</dd>
          </div>
          <div>
            <dt className="font-semibold">저장된 Gaze Sample 수</dt>
            <dd>{timelineState.timelineSize}</dd>
          </div>
          <div>
            <dt className="font-semibold">가장 오래된 sample sourceCapturedAt</dt>
            <dd>{toTimeText(timelineState.oldestSampleSourceCapturedAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold">가장 최근 sample sourceCapturedAt</dt>
            <dd>{toTimeText(timelineState.newestSampleSourceCapturedAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold">마지막 저장 frameId</dt>
            <dd>{timelineState.lastStoredFrameId ?? "-"}</dd>
          </div>
          <div>
            <dt className="font-semibold">마지막 저장 sourceCapturedAt</dt>
            <dd>{toTimeText(timelineState.lastStoredSourceCapturedAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold">마지막 저장 processingCompletedAt</dt>
            <dd>{toTimeText(timelineState.lastStoredProcessingCompletedAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold">마지막 End-to-end latency</dt>
            <dd>{toDurationText(timelineState.lastEndToEndLatencyMs)}</dd>
          </div>
          <div>
            <dt className="font-semibold">최근 1초 Sample 수</dt>
            <dd>{timelineState.recentOneSecondSampleCount}</dd>
          </div>
          <div>
            <dt className="font-semibold">중복/역행 frame 감지</dt>
            <dd>{timelineState.duplicateFrameCount}</dd>
          </div>
          <div>
            <dt className="font-semibold">최근 1초 조회 결과</dt>
            <dd>
              count: {recentCount}, startAt: {recentWindow.startAt}, endAt: {recentWindow.endAt},
              firstFrame: {recentWindow.firstAt}, lastFrame: {recentWindow.lastAt}
            </dd>
          </div>
        </dl>
      </section>
      <section className="mt-3 flex flex-wrap gap-3">
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
          onClick={clearTimeline}
          disabled={timelineState.timelineSize === 0}
          className="rounded-md border border-slate-500 bg-white px-4 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 hover:bg-slate-100"
        >
          Timeline Clear
        </button>
        <button
          type="button"
          onClick={queryRecentWindow}
          className="rounded-md border border-slate-500 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
        >
          최근 1초 조회
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
          disabled={!stats.eyeGeometryInitialized || isGeometryBusy || !isRunning}
          className={resetButtonClass}
        >
          {resetButtonLabel}
        </button>
      </section>
      <section className="mt-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Eye Geometry Control</p>
        <p className="mt-1">
          상태: <span className={stats.eyeGeometryInitialized ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
            {stats.eyeGeometryInitialized ? "Initialized" : "Not Initialized"}
          </span>
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
