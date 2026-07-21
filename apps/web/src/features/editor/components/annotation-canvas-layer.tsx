import { forwardRef, useImperativeHandle, useRef } from "react";
import type { NativeCanvasRenderer } from "../adapters/canvas/canvas-2d-renderer";

type PointerCanvasEvent = React.PointerEvent<HTMLElement>;

export type AnnotationCanvasHandle = {
  getCanvas: () => HTMLCanvasElement | null;
};

type AnnotationCanvasLayerProps = {
  width: number;
  height: number;
  onPointerDown: (event: PointerCanvasEvent) => void;
  onPointerMove: (event: PointerCanvasEvent) => void;
  onPointerUp: (event: PointerCanvasEvent) => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  hidden?: boolean;
};

export const AnnotationCanvasLayer = forwardRef<AnnotationCanvasHandle, AnnotationCanvasLayerProps>(
  ({ width, height, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, hidden }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        getCanvas: () => canvasRef.current,
      }),
      [],
    );

    return (
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{
          pointerEvents: hidden ? "none" : "auto",
          position: "absolute",
          inset: 0,
        }}
        width={Math.max(1, Math.round(width))}
        height={Math.max(1, Math.round(height))}
        aria-label="annotation canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
      />
    );
  },
);

AnnotationCanvasLayer.displayName = "AnnotationCanvasLayer";

