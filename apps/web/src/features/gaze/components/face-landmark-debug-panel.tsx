import type { FaceTrackingSessionStats } from "../runtime/face-tracking-session";

type DebugPanelProps = {
  stats: FaceTrackingSessionStats;
};

export function FaceLandmarkDebugPanel({ stats }: DebugPanelProps): React.ReactElement {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase text-slate-500">Face Landmark Status</h2>
      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="font-semibold">세션 상태</dt>
          <dd>{stats.status}</dd>
        </div>
        <div>
          <dt className="font-semibold">얼굴 검출</dt>
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
