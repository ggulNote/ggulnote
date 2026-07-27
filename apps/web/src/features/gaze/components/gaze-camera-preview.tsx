import type { FaceLandmarkFrame } from "@ggulnote/gaze-core";
import { LEFT_IRIS_CENTER_INDEX, RIGHT_IRIS_CENTER_INDEX } from "../mediapipe/face-landmark-adapter";

type GazeCameraPreviewProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  className?: string;
};

export function GazeCameraPreview({
  videoRef,
  overlayCanvasRef,
  className,
}: GazeCameraPreviewProps): React.ReactElement {
  return (
    <section className={className ?? "relative w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-3"}>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Gaze camera"
          className="h-full w-full bg-black object-contain"
        />
        <canvas
          ref={overlayCanvasRef}
          aria-label="Face landmark overlay"
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      </div>
    </section>
  );
}

function drawPoint(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();
}

export function drawLandmarkOverlay(
  canvas: HTMLCanvasElement | null,
  frame: FaceLandmarkFrame | null,
): void {
  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  if (!frame) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  if (canvas.width !== frame.frameWidth || canvas.height !== frame.frameHeight) {
    canvas.width = frame.frameWidth;
    canvas.height = frame.frameHeight;
  }

  context.clearRect(0, 0, frame.frameWidth, frame.frameHeight);

  for (let index = 0; index < frame.landmarks.length; index += 1) {
    const landmark = frame.landmarks[index];
    const x = landmark.x * frame.frameWidth;
    const y = landmark.y * frame.frameHeight;
    drawPoint(context, x, y, "rgba(255, 255, 255, 0.55)");
  }

  const leftIris = frame.landmarks[LEFT_IRIS_CENTER_INDEX];
  const rightIris = frame.landmarks[RIGHT_IRIS_CENTER_INDEX];

  if (leftIris) {
    drawPoint(context, leftIris.x * frame.frameWidth, leftIris.y * frame.frameHeight, "rgba(16, 185, 129, 0.95)");
  }

  if (rightIris) {
    drawPoint(context, rightIris.x * frame.frameWidth, rightIris.y * frame.frameHeight, "rgba(59, 130, 246, 0.95)");
  }
}
