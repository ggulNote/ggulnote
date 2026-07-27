import type { FaceTrackingSessionStats } from "../runtime/face-tracking-session";

type DebugPanelProps = {
  stats: FaceTrackingSessionStats;
};

function toVectorText(value: { x: number; y: number; z: number } | null): string {
  if (!value) {
    return "-";
  }

  const round = (v: number): number => Math.round(v * 1000) / 1000;
  return `(${round(value.x)}, ${round(value.y)}, ${round(value.z)})`;
}

function vectorNorm(value: { x: number; y: number; z: number } | null): string {
  if (!value) {
    return "-";
  }

  const norm = Math.sqrt(value.x ** 2 + value.y ** 2 + value.z ** 2);
  return `${Math.round(norm * 1000) / 1000}`;
}

export function FaceLandmarkDebugPanel({ stats }: DebugPanelProps): React.ReactElement {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase text-slate-500">Gaze Pipeline Status</h2>
      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="font-semibold">세션 상태</dt>
          <dd>{stats.status}</dd>
        </div>
        <div>
          <dt className="font-semibold">Raw Gaze 상태</dt>
          <dd>{stats.rawGazeStatus ?? "-"}</dd>
        </div>
        <div>
          <dt>얼굴 검출</dt>
          <dd>{stats.faceDetected ? "true" : "false"}</dd>
        </div>
        <div>
          <dt>Landmark 개수</dt>
          <dd>{stats.landmarkCount}</dd>
        </div>
        <div>
          <dt>Frame ID</dt>
          <dd>{stats.frameId}</dd>
        </div>
        <div>
          <dt>Source Captured At</dt>
          <dd>{stats.sourceCapturedAt ?? "-"}</dd>
        </div>
        <div>
          <dt>처리 시작</dt>
          <dd>{stats.processingStartedAt ?? "-"}</dd>
        </div>
        <div>
          <dt>처리 완료</dt>
          <dd>{stats.processingCompletedAt ?? "-"}</dd>
        </div>
        <div>
          <dt>전체 처리 지연</dt>
          <dd>{stats.processingLatencyMs !== null ? `${Math.round(stats.processingLatencyMs)} ms` : "-"}</dd>
        </div>
        <div>
          <dt>Worker inferenceDurationMs</dt>
          <dd>{stats.inferenceDurationMs !== null ? `${Math.round(stats.inferenceDurationMs)} ms` : "-"}</dd>
        </div>
        <div>
          <dt>Gaze computationDurationMs</dt>
          <dd>{stats.gazeComputationDurationMs !== null ? `${Math.round(stats.gazeComputationDurationMs)} ms` : "-"}</dd>
        </div>
        <div>
          <dt>Worker totalDurationMs</dt>
          <dd>{stats.totalWorkerDurationMs !== null ? `${Math.round(stats.totalWorkerDurationMs)} ms` : "-"}</dd>
        </div>
        <div>
          <dt>FPS</dt>
          <dd>{stats.fps}</dd>
        </div>
        <div>
          <dt>Dropped Frames</dt>
          <dd>{stats.droppedFrameCount}</dd>
        </div>
        <div>
          <dt>Tracking Confidence</dt>
          <dd>{stats.trackingConfidence === null ? "-" : stats.trackingConfidence.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Eye Geometry 초기화</dt>
          <dd>{stats.eyeGeometryInitialized ? `yes (frame #${stats.eyeGeometryInitializedFromFrameId ?? "-"})` : "no"}</dd>
        </div>
        <div>
          <dt>Eye Geometry init At</dt>
          <dd>{stats.eyeGeometryInitializedAt ?? "-"}</dd>
        </div>
        <div>
          <dt>왼쪽 방향</dt>
          <dd>{toVectorText(stats.leftDirection)}</dd>
        </div>
        <div>
          <dt>오른쪽 방향</dt>
          <dd>{toVectorText(stats.rightDirection)}</dd>
        </div>
        <div>
          <dt>Raw Combined</dt>
          <dd>{toVectorText(stats.rawCombinedDirection)}</dd>
        </div>
        <div>
          <dt>Smoothed Combined</dt>
          <dd>{toVectorText(stats.smoothedCombinedDirection)}</dd>
        </div>
        <div>
          <dt>Combined Norm</dt>
          <dd>{vectorNorm(stats.smoothedCombinedDirection)}</dd>
        </div>
        <div>
          <dt>Sample Count</dt>
          <dd>{stats.sampleCount ?? "-"}</dd>
        </div>
        <div>
          <dt>오른쪽 각막 중심</dt>
          <dd>{toVectorText(stats.eyeSphereRight)}</dd>
        </div>
        <div>
          <dt>왼쪽 각막 중심</dt>
          <dd>{toVectorText(stats.eyeSphereLeft)}</dd>
        </div>
        <div className="md:col-span-2">
          <dt>Raw Gaze 메시지</dt>
          <dd className="break-words text-xs text-slate-700">{stats.rawGazeMessage ?? "-"}</dd>
        </div>
        <div className="md:col-span-2">
          <dt>마지막 오류</dt>
          <dd className="break-words">{stats.lastError?.message ?? "-"}</dd>
        </div>
        <div>
          <dt>프레임 크기</dt>
          <dd>
            {stats.frameWidth !== null && stats.frameHeight !== null
              ? `${stats.frameWidth} × ${stats.frameHeight}`
              : "-"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
