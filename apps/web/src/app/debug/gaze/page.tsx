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
  droppedFrameCount: 0,
  fps: 0,
  lastError: null,
  frameWidth: null,
  frameHeight: null,
  trackingConfidence: null,
};

export default function DebugGazePage(): React.ReactElement {
  const clockRef = useRef<InteractionClock | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<FaceTrackingSession | null>(null);
  const statsRef = useRef(initialStats);
  const [stats, setStats] = useState(initialStats);
  const [running, setRunning] = useState(false);

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
      setRunning(false);
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
            setRunning(next.status === "running" || next.status === "loading-model" || next.status === "requesting-camera");
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
    setRunning(false);
  };

  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Face Landmark Debug</h1>
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

      <section className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => {
            void start();
          }}
          disabled={running}
          className="rounded-md border border-slate-900 px-4 py-2 font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Start Camera
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!running}
          className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Stop Camera
        </button>
      </section>
    </main>
  );
}
