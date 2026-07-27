import type { FaceLandmarkFrame, HeadCoordinateFrame, Vector3 } from "@ggulnote/gaze-core";
import {
  LEFT_IRIS_CENTER_INDEX,
  RIGHT_IRIS_CENTER_INDEX,
} from "../mediapipe/face-landmark-adapter";

type SourcePoint = Readonly<{ x: number; y: number }>;
type GazeCameraPreviewProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  className?: string;
};

type VectorOverlayData = {
  readonly leftDirection: Vector3 | null;
  readonly rightDirection: Vector3 | null;
  readonly rawCombinedDirection: Vector3 | null;
  readonly smoothedCombinedDirection: Vector3 | null;
  readonly head: HeadCoordinateFrame | null;
  readonly leftEyeSphere: Vector3 | null;
  readonly rightEyeSphere: Vector3 | null;
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

function drawVectorLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.font = "11px ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(text, x + 4, y - 4);
}

function drawAxisLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.font = "10px ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(text, x + 4, y - 4);
}

function isFiniteNumberVector3(value: Vector3 | null | undefined): value is Vector3 {
  return (
    !!value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z)
    && Number.isFinite(Math.hypot(value.x, value.y, value.z))
  );
}

function isFiniteMatrix(matrix: Readonly<HeadCoordinateFrame["rotation"]> | null | undefined): matrix is Readonly<
  HeadCoordinateFrame["rotation"]
> {
  return !!matrix && matrix.every((value) => Number.isFinite(value));
}

function isFinitePoint(point: Vector3 | null | undefined): point is Vector3 {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function selectFinitePoint(primary: Vector3 | null | undefined, fallback: Vector3 | null | undefined): Vector3 | null {
  if (isFinitePoint(primary)) {
    return primary;
  }

  return isFinitePoint(fallback) ? fallback : null;
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
): SourcePoint {
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

function drawArrow(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: string,
): void {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) {
    return;
  }

  const arrowSize = Math.max(4, Math.min(length * 0.15, 10));
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  const angle = Math.atan2(dy, dx);
  const headAngle1 = angle + Math.PI * 0.8;
  const headAngle2 = angle - Math.PI * 0.8;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX + Math.cos(headAngle1) * arrowSize, endY + Math.sin(headAngle1) * arrowSize);
  ctx.lineTo(endX + Math.cos(headAngle2) * arrowSize, endY + Math.sin(headAngle2) * arrowSize);
  ctx.closePath();
  ctx.fill();
}

function projectWorldDirectionToCanvas(
  origin: Vector3,
  direction: Vector3,
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
  scaleFactor: number,
): SourcePoint {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(length) || length === 0) {
    return toCanvasPoint(origin.x, origin.y, sourceWidth, sourceHeight, containerWidth, containerHeight);
  }

  const normalized = {
    x: direction.x / length,
    y: direction.y / length,
    z: direction.z / length,
  };

  const end = {
    x: origin.x + normalized.x * scaleFactor,
    y: origin.y + normalized.y * scaleFactor,
    z: origin.z + normalized.z * scaleFactor,
  };

  return toCanvasPoint(end.x, end.y, sourceWidth, sourceHeight, containerWidth, containerHeight);
}

function drawAxisLine(ctx: CanvasRenderingContext2D, origin: SourcePoint, end: SourcePoint, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function drawHeadAxes(
  ctx: CanvasRenderingContext2D,
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
  head: HeadCoordinateFrame | null | undefined,
): void {
  if (!head || !isFiniteMatrix(head.rotation) || !isFinitePoint(head.center)) {
    return;
  }

  const origin = toCanvasPoint(
    head.center.x,
    head.center.y,
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
  );

  const axisLength = Math.min(sourceWidth, sourceHeight) * 0.14;
  const xEnd = projectWorldDirectionToCanvas(
    head.center,
    {
      x: head.rotation[0],
      y: head.rotation[3],
      z: head.rotation[6],
    },
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
    axisLength,
  );
  const yEnd = projectWorldDirectionToCanvas(
    head.center,
    {
      x: head.rotation[1],
      y: head.rotation[4],
      z: head.rotation[7],
    },
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
    axisLength,
  );
  const zEnd = projectWorldDirectionToCanvas(
    head.center,
    {
      x: head.rotation[2],
      y: head.rotation[5],
      z: head.rotation[8],
    },
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
    axisLength,
  );

  drawAxisLine(ctx, origin, xEnd, "rgba(16, 185, 129, 0.95)");
  drawAxisLine(ctx, origin, yEnd, "rgba(59, 130, 246, 0.95)");
  drawAxisLine(ctx, origin, zEnd, "rgba(245, 158, 11, 1)");
  drawAxisLabel(ctx, "X", xEnd.x, xEnd.y, "rgba(16, 185, 129, 0.95)");
  drawAxisLabel(ctx, "Y", yEnd.x, yEnd.y, "rgba(59, 130, 246, 0.95)");
  drawAxisLabel(ctx, "Z", zEnd.x, zEnd.y, "rgba(245, 158, 11, 1)");
}

function drawGazeVector(
  ctx: CanvasRenderingContext2D,
  originSource: Vector3,
  direction: Vector3 | null,
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
  color: string,
  scaleRate: number,
): SourcePoint | null {
  if (!isFiniteNumberVector3(direction)) {
    return null;
  }

  const origin = toCanvasPoint(
    originSource.x,
    originSource.y,
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
  );

  const end = projectWorldDirectionToCanvas(
    originSource,
    direction,
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
    Math.min(sourceWidth, sourceHeight) * scaleRate,
  );

  drawArrow(ctx, origin.x, origin.y, end.x, end.y, color);
  return end;
}

export function drawLandmarkOverlay(
  canvas: HTMLCanvasElement | null,
  frame: FaceLandmarkFrame | null,
  vectors?: VectorOverlayData,
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
    const point = toCanvasPoint(
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      width,
      height,
    );

    drawPoint(context, point.x, point.y, "rgba(255, 255, 255, 0.55)");

    if (Number.isFinite(landmark.x) && Number.isFinite(landmark.y)) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
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
    const point = toCanvasPoint(
      leftIris.x * sourceWidth,
      leftIris.y * sourceHeight,
      sourceWidth,
      sourceHeight,
      width,
      height,
    );
    drawPoint(context, point.x, point.y, "rgba(16, 185, 129, 0.95)");
    drawRect(context, point.x - 8, point.y - 8, 16, 16, "rgba(16, 185, 129, 0.95)", 2);
    drawCross(context, point.x, point.y, "rgba(16, 185, 129, 0.95)");
  }

  if (rightIris) {
    const point = toCanvasPoint(
      rightIris.x * sourceWidth,
      rightIris.y * sourceHeight,
      sourceWidth,
      sourceHeight,
      width,
      height,
    );
    drawPoint(context, point.x, point.y, "rgba(59, 130, 246, 0.95)");
    drawRect(context, point.x - 8, point.y - 8, 16, 16, "rgba(59, 130, 246, 0.95)", 2);
    drawCross(context, point.x, point.y, "rgba(59, 130, 246, 0.95)");
  }

  if (leftIris && rightIris) {
    const leftPoint = toCanvasPoint(
      leftIris.x * sourceWidth,
      leftIris.y * sourceHeight,
      sourceWidth,
      sourceHeight,
      width,
      height,
    );
    const rightPoint = toCanvasPoint(
      rightIris.x * sourceWidth,
      rightIris.y * sourceHeight,
      sourceWidth,
      sourceHeight,
      width,
      height,
    );
    drawArrow(context, leftPoint.x, leftPoint.y, rightPoint.x, rightPoint.y, "rgba(255, 99, 132, 0.85)");
    drawVectorLabel(context, "Face", rightPoint.x, rightPoint.y, "rgba(255, 99, 132, 0.95)");
  }

  if (!vectors) {
    return;
  }

  drawHeadAxes(context, sourceWidth, sourceHeight, width, height, vectors.head);

  if (leftIris) {
    const leftOrigin = selectFinitePoint(vectors.leftEyeSphere, leftIris);
    const leftEnd = leftOrigin === null
      ? null
      : drawGazeVector(
          context,
          leftOrigin,
          vectors.leftDirection,
          sourceWidth,
          sourceHeight,
          width,
          height,
          "rgba(16, 185, 129, 0.95)",
          0.16,
        );
    if (leftEnd) {
      drawVectorLabel(context, "L gaze", leftEnd.x, leftEnd.y, "rgba(16, 185, 129, 0.95)");
    }
  }

  if (rightIris) {
    const rightOrigin = selectFinitePoint(vectors.rightEyeSphere, rightIris);
    const rightEnd = rightOrigin === null
      ? null
      : drawGazeVector(
          context,
          rightOrigin,
          vectors.rightDirection,
          sourceWidth,
          sourceHeight,
          width,
          height,
          "rgba(59, 130, 246, 0.95)",
          0.16,
        );
    if (rightEnd) {
      drawVectorLabel(context, "R gaze", rightEnd.x, rightEnd.y, "rgba(59, 130, 246, 0.95)");
    }
  }

  const leftCombinedOriginSource = leftIris && vectors.leftEyeSphere
    ? vectors.leftEyeSphere
    : null;
  const rightCombinedOriginSource = rightIris && vectors.rightEyeSphere
    ? vectors.rightEyeSphere
    : null;

  if (leftCombinedOriginSource && rightCombinedOriginSource) {
    const midpointSource = {
      x: ((leftCombinedOriginSource.x + rightCombinedOriginSource.x) / 2),
      y: ((leftCombinedOriginSource.y + rightCombinedOriginSource.y) / 2),
      z: ((leftCombinedOriginSource.z + rightCombinedOriginSource.z) / 2),
    };
    const midpointCanvas = toCanvasPoint(
      midpointSource.x,
      midpointSource.y,
      sourceWidth,
      sourceHeight,
      width,
      height,
    );

    if (isFiniteNumberVector3(vectors.smoothedCombinedDirection)) {
      const end = drawGazeVector(
        context,
        midpointSource,
        vectors.smoothedCombinedDirection,
        sourceWidth,
        sourceHeight,
        width,
        height,
        "rgba(245, 158, 11, 1)",
        0.18,
      );
      if (end) {
        drawVectorLabel(context, "Combined (smoothed)", end.x, end.y, "rgba(245, 158, 11, 1)");
      }
    }

    if (isFiniteNumberVector3(vectors.rawCombinedDirection)) {
      const end = projectWorldDirectionToCanvas(
        midpointSource,
        vectors.rawCombinedDirection,
        sourceWidth,
        sourceHeight,
        width,
        height,
        Math.min(sourceWidth, sourceHeight) * 0.14,
      );
      drawArrow(
        context,
        midpointCanvas.x,
        midpointCanvas.y,
        end.x,
        end.y,
        "rgba(251, 146, 60, 0.9)",
      );
      drawVectorLabel(context, "Combined (raw)", end.x, end.y, "rgba(251, 146, 60, 0.9)");
    }
  }
}
