import type { CSSProperties } from "react";

import type { PursuitCalibrationSnapshot } from "../application/pursuit-calibration-controller";
import type { PursuitCalibrationConfig } from "../config/pursuit-calibration-config";
import type { ViewportRect } from "../domain/calibration-types";
import type { PursuitDirectionVector } from "../domain/pursuit-types";

const OVERLAY_Z_INDEX = 40;
const ARROW_LENGTH_PX = 28;
const ARROW_HEAD_SIZE_PX = 8;
const ARROW_GAP_PX = 12;
const ARROW_STROKE_WIDTH_PX = 3;

const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

type PursuitTargetOverlayCommonProps = Readonly<{
  readonly snapshot: PursuitCalibrationSnapshot;
  readonly config: PursuitCalibrationConfig;
  readonly className?: string;
}>;

type BrowserViewportOverlayProps = Readonly<{
  readonly coordinateSpace?: "browser-viewport";
  readonly viewportRect?: never;
}>;

type ViewportLocalOverlayProps = Readonly<{
  readonly coordinateSpace: "viewport-local";
  readonly viewportRect: ViewportRect;
}>;

export type PursuitTargetOverlayProps = PursuitTargetOverlayCommonProps
  & (BrowserViewportOverlayProps | ViewportLocalOverlayProps);

/**
 * Renders Controller-provided CSS-pixel coordinates without trajectory math.
 * Browser mode is a fixed viewport layer. Local mode is an absolute layer and
 * subtracts viewportRect.left/top exactly once.
 */
export function PursuitTargetOverlay({
  snapshot,
  config,
  className,
  coordinateSpace = "browser-viewport",
  viewportRect,
}: PursuitTargetOverlayProps) {
  const target = snapshot.currentTarget;
  const isLocal = coordinateSpace === "viewport-local";
  const localViewportRect =
    coordinateSpace === "viewport-local" ? viewportRect : undefined;

  if (coordinateSpace === "viewport-local" && localViewportRect === undefined) {
    return null;
  }

  const offsetX = localViewportRect?.left ?? 0;
  const offsetY = localViewportRect?.top ?? 0;
  const centerX = target === null ? 0 : target.center.x - offsetX;
  const centerY = target === null ? 0 : target.center.y - offsetY;
  const directionAngle = target === null
    ? null
    : getDirectionAngle(target.nextDirection);
  const showArrow = target !== null
    && target.showDirectionCue
    && directionAngle !== null;
  const targetColor = getTargetColor(snapshot.phase);

  return (
    <div
      className={className}
      data-coordinate-space={coordinateSpace}
      data-testid="pursuit-target-overlay"
      style={{
        position: isLocal ? "absolute" : "fixed",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: OVERLAY_Z_INDEX,
      }}
    >
      <span role="status" style={VISUALLY_HIDDEN_STYLE}>
        {`Smooth pursuit calibration phase: ${snapshot.phase}`}
      </span>
      {target !== null && target.showTarget ? (
        <div
          aria-hidden="true"
          data-bounds-bottom={target.bounds.bottom}
          data-bounds-left={target.bounds.left}
          data-bounds-right={target.bounds.right}
          data-bounds-top={target.bounds.top}
          data-movement-progress={target.movementProgress}
          data-phase={snapshot.phase}
          data-testid="pursuit-target"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: config.target.diameterPx,
            height: config.target.diameterPx,
            boxSizing: "border-box",
            border: `${config.target.borderWidthPx}px solid ${targetColor}`,
            borderRadius: "50%",
            background: "rgba(255, 247, 237, 0.92)",
            boxShadow: `0 0 0 4px ${targetColor}22`,
            pointerEvents: "none",
            transform: `translate3d(${centerX}px, ${centerY}px, 0) translate(-50%, -50%)`,
            willChange: "transform",
          }}
        >
          <span
            data-testid="pursuit-target-center-dot"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: config.target.centerDotDiameterPx,
              height: config.target.centerDotDiameterPx,
              borderRadius: "50%",
              background: "#111827",
              pointerEvents: "none",
              transform: "translate(-50%, -50%)",
            }}
          />
          {showArrow ? (
            <svg
              data-angle-rad={directionAngle}
              data-testid="pursuit-direction-arrow"
              height={ARROW_HEAD_SIZE_PX * 2}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                color: targetColor,
                overflow: "visible",
                pointerEvents: "none",
                transform: [
                  "translateY(-50%)",
                  `rotate(${directionAngle}rad)`,
                  `translateX(${config.target.diameterPx / 2 + ARROW_GAP_PX}px)`,
                ].join(" "),
                transformOrigin: "0 50%",
              }}
              viewBox={`0 ${-ARROW_HEAD_SIZE_PX} ${ARROW_LENGTH_PX} ${ARROW_HEAD_SIZE_PX * 2}`}
              width={ARROW_LENGTH_PX}
            >
              <line
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth={ARROW_STROKE_WIDTH_PX}
                x1="0"
                x2={ARROW_LENGTH_PX}
                y1="0"
                y2="0"
              />
              <polyline
                fill="none"
                points={[
                  `${ARROW_LENGTH_PX - ARROW_HEAD_SIZE_PX},${-ARROW_HEAD_SIZE_PX}`,
                  `${ARROW_LENGTH_PX},0`,
                  `${ARROW_LENGTH_PX - ARROW_HEAD_SIZE_PX},${ARROW_HEAD_SIZE_PX}`,
                ].join(" ")}
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={ARROW_STROKE_WIDTH_PX}
              />
            </svg>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getDirectionAngle(direction: PursuitDirectionVector | null): number | null {
  if (
    direction === null
    || !Number.isFinite(direction.x)
    || !Number.isFinite(direction.y)
    || Math.hypot(direction.x, direction.y) <= Number.EPSILON
  ) {
    return null;
  }
  return Math.atan2(direction.y, direction.x);
}

function getTargetColor(
  phase: PursuitCalibrationSnapshot["phase"],
): string {
  switch (phase) {
    case "direction-cue":
    case "validation-direction-cue":
      return "#d97706";
    case "moving":
    case "validation-moving":
      return "#0f766e";
    case "segment-stop":
    case "validation-segment-stop":
      return "#dc2626";
    default:
      return "#2563eb";
  }
}
