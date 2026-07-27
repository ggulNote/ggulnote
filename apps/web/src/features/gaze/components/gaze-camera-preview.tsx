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

function resizeCanvasToDisplay(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return { width, height };
}

function getContainTransform(
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const renderWidth = sourceWidth * scale;
  const renderHeight = sourceHeight * scale;

  return {
    scale,
    offsetX: (containerWidth - renderWidth) / 2,
    offsetY: (containerHeight - renderHeight) / 2,
  };
}

function toCanvasPoint(
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  const { scale, offsetX, offsetY } = getContainTransform(
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
  );

  return {
    x: sourceX * scale + offsetX,
    y: sourceY * scale + offsetY,
  };
}

function drawCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size = 8,
  lineWidth = 2,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, width, height);
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
    resizeCanvasToDisplay(canvas);
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const { width, height } = resizeCanvasToDisplay(canvas);
  const sourceWidth = frame.frameWidth;
  const sourceHeight = frame.frameHeight;

  context.clearRect(0, 0, width, height);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let hasFinitePoint = false;

  for (let index = 0; index < frame.landmarks.length; index += 1) {
    const landmark = frame.landmarks[index];
    const sourceX = landmark.x * sourceWidth;
    const sourceY = landmark.y * sourceHeight;
    const { x, y } = toCanvasPoint(sourceX, sourceY, sourceWidth, sourceHeight, width, height);
    drawPoint(context, x, y, "rgba(255, 255, 255, 0.55)");

    if (Number.isFinite(landmark.x) && Number.isFinite(landmark.y)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      hasFinitePoint = true;
    }
  }

  if (hasFinitePoint) {
    const paddingX = Math.max(4, frame.frameWidth * 0.02);
    const paddingY = Math.max(4, frame.frameHeight * 0.02);
    const x = Math.max(0, minX - paddingX);
    const y = Math.max(0, minY - paddingY);
    const bboxWidth = Math.min(width - x, maxX - minX + paddingX * 2);
    const bboxHeight = Math.min(height - y, maxY - minY + paddingY * 2);
    drawRect(context, x, y, bboxWidth, bboxHeight, "rgba(255, 204, 0, 0.9)", 2);
  }

  const leftIris = frame.landmarks[LEFT_IRIS_CENTER_INDEX];
  const rightIris = frame.landmarks[RIGHT_IRIS_CENTER_INDEX];

  if (leftIris) {
    const sourceX = leftIris.x * sourceWidth;
    const sourceY = leftIris.y * sourceHeight;
    const { x, y } = toCanvasPoint(sourceX, sourceY, sourceWidth, sourceHeight, width, height);
    drawPoint(context, x, y, "rgba(16, 185, 129, 0.95)");
    drawRect(context, x - 8, y - 8, 16, 16, "rgba(16, 185, 129, 0.95)", 2);
    drawCross(context, x, y, "rgba(16, 185, 129, 0.95)");
  }

  if (rightIris) {
    const sourceX = rightIris.x * sourceWidth;
    const sourceY = rightIris.y * sourceHeight;
    const { x, y } = toCanvasPoint(sourceX, sourceY, sourceWidth, sourceHeight, width, height);
    drawPoint(context, x, y, "rgba(59, 130, 246, 0.95)");
    drawRect(context, x - 8, y - 8, 16, 16, "rgba(59, 130, 246, 0.95)", 2);
    drawCross(context, x, y, "rgba(59, 130, 246, 0.95)");
  }
}
