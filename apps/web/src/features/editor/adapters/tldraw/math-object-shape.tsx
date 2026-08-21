import {
  MATH_TLDRAW_SHAPE_TYPE,
  createMathVisualModel,
  parseMathObject,
  type MathObjectKind,
  type MathVisualModel,
  type MathVisualPrimitive,
} from "@ggulnote/math-core";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type SvgExportContext,
  type TLBaseShape,
} from "tldraw";
import { createMathPrimitivePathBuilder } from "./math-primitive-path-builder";
import {
  createMathGraphStrokeAnimationPlan,
  readMathGraphCreateAnimation,
  type MathGraphStrokeAnimation,
} from "./math-graph-animation";
import {
  readWriteOn,
  type WriteOnAnimation,
} from "./write-on-presentation";

export type MathObjectShape = TLBaseShape<
  typeof MATH_TLDRAW_SHAPE_TYPE,
  {
    w: number;
    h: number;
    logicalObjectId: string;
    objectKind: MathObjectKind;
    serializedObject: string;
  }
>;

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [MATH_TLDRAW_SHAPE_TYPE]: MathObjectShape["props"];
  }
}

export class MathObjectShapeUtil extends ShapeUtil<MathObjectShape> {
  public static override type = MATH_TLDRAW_SHAPE_TYPE;
  public static override props: RecordProps<MathObjectShape> = {
    w: T.number,
    h: T.number,
    logicalObjectId: T.string,
    objectKind: T.literalEnum("expression", "table", "graph", "shape", "arithmetic_layout"),
    serializedObject: T.string,
  };

  public getDefaultProps(): MathObjectShape["props"] {
    return {
      w: 1,
      h: 1,
      logicalObjectId: "unbound",
      objectKind: "expression",
      serializedObject: "",
    };
  }

  public getGeometry(shape: MathObjectShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  public component(shape: MathObjectShape) {
    let model: MathVisualModel;
    try {
      model = toMathShapeVisualModel(shape.props);
    } catch {
      return (
        <HTMLContainer style={{ pointerEvents: "none" }}>
          <div
            style={{
              alignItems: "center",
              border: "1px dashed #dc2626",
              color: "#991b1b",
              display: "flex",
              fontSize: 12,
              height: "100%",
              justifyContent: "center",
              width: "100%",
            }}
          >
            Invalid math object
          </div>
        </HTMLContainer>
      );
    }
    const graphAnimation = shape.props.objectKind === "graph"
      && model.renderingHint === "hand-drawn"
      ? readMathGraphCreateAnimation(model.logicalObjectId)
      : undefined;
    const strokeAnimationPlan = graphAnimation === undefined
      ? undefined
      : createMathGraphStrokeAnimationPlan(model.primitives, graphAnimation.elapsedMs);
    const writeOn = shape.props.objectKind === "expression"
      && model.renderingHint === "hand-drawn"
      ? readWriteOn(mathWriteOnKey(model.logicalObjectId))
      : undefined;
    const writeOnClipId = `ggulnote-math-write-on-${safeSvgId(model.logicalObjectId)}`;
    return (
      <HTMLContainer style={{ pointerEvents: "none" }}>
        <svg
          aria-label={`${shape.props.objectKind} math object`}
          height={shape.props.h}
          overflow="hidden"
          role="img"
          viewBox={`0 0 ${shape.props.w} ${shape.props.h}`}
          width={shape.props.w}
        >
          {graphAnimation === undefined && writeOn === undefined
            ? null
            : <style>{MATH_ANIMATION_STYLES}</style>}
          {model.backgroundColor === "transparent" ? null : (
            <rect
              fill={model.backgroundColor}
              height={model.height}
              width={model.width}
              x={0}
              y={0}
            />
          )}
          {writeOn === undefined ? null : (
            <defs>
              <clipPath id={writeOnClipId}>
                <rect
                  className="ggulnote-math-write-on-mask"
                  height={model.height}
                  style={writeOnStyle(writeOn)}
                  width={model.width}
                  x={0}
                  y={0}
                />
              </clipPath>
            </defs>
          )}
          <g clipPath={writeOn === undefined ? undefined : `url(#${writeOnClipId})`}>
            {model.primitives.map((primitive) => renderPrimitive(
              primitive,
              model.renderingHint,
              model.logicalObjectId,
              strokeAnimationPlan?.get(primitive.id),
              primitive.kind === "text" ? graphAnimation?.remainingMs : undefined,
            ))}
          </g>
        </svg>
      </HTMLContainer>
    );
  }

  public toSvg(shape: MathObjectShape, _context: SvgExportContext) {
    const model = toMathShapeVisualModel(shape.props);
    return (
      <g>
        {model.backgroundColor === "transparent" ? null : (
          <rect
            fill={model.backgroundColor}
            height={model.height}
            width={model.width}
            x={0}
            y={0}
          />
        )}
        {model.primitives.map((primitive) => renderPrimitive(
          primitive,
          model.renderingHint,
          model.logicalObjectId,
        ))}
      </g>
    );
  }

  public getIndicatorPath(shape: MathObjectShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

export function mathWriteOnKey(logicalObjectId: string): string {
  return `math-expression:${logicalObjectId}`;
}

function writeOnStyle(animation: WriteOnAnimation): React.CSSProperties {
  return {
    animationDelay: `${-animation.elapsedMs}ms`,
    animationDuration: `${animation.durationMs}ms`,
    animationFillMode: "both",
    animationName: "ggulnoteMathWriteOn",
    animationTimingFunction: "cubic-bezier(0.2, 0.75, 0.25, 1)",
    transformBox: "fill-box",
    transformOrigin: "left center",
  };
}

function safeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-");
}

export const toMathShapeVisualModel = (props: MathObjectShape["props"]) => {
  const object = parseMathObject(props.serializedObject);
  if (object.id !== props.logicalObjectId || object.kind !== props.objectKind) {
    throw new TypeError("Math shape props do not match the serialized logical object.");
  }
  return createMathVisualModel(object);
};

function renderPrimitive(
  primitive: MathVisualPrimitive,
  renderingHint: MathVisualModel["renderingHint"],
  logicalObjectId: string,
  strokeAnimation?: MathGraphStrokeAnimation,
  contentRevealDelayMs?: number,
): React.ReactElement {
  if (renderingHint === "hand-drawn" && primitive.kind !== "text") {
    const handDrawn = renderHandDrawnPrimitive(
      primitive,
      logicalObjectId,
      strokeAnimation,
    );
    if (handDrawn !== undefined) return handDrawn;
  }
  return renderPrecisePrimitive(primitive, contentRevealDelayMs);
}

function renderHandDrawnPrimitive(
  primitive: Exclude<MathVisualPrimitive, { readonly kind: "text" }>,
  logicalObjectId: string,
  animation?: MathGraphStrokeAnimation,
): React.ReactElement | undefined {
  const path = createMathPrimitivePathBuilder(primitive);
  if (path === undefined) return undefined;
  const fill = renderPrimitiveFill(primitive);
  const stroke = path.toSvg({
    style: "draw",
    strokeWidth: primitive.strokeWidth,
    randomSeed: `${logicalObjectId}:${primitive.id}`,
    passes: 2,
    props: {
      ...(animation === undefined ? {} : {
        className: "ggulnote-math-animated-stroke",
        pathLength: 1,
        style: {
          animationDelay: `${animation.delayMs}ms`,
          animationDuration: `${animation.durationMs}ms`,
          animationFillMode: "both",
          animationName: "ggulnoteMathStrokeDraw",
          animationTimingFunction: "linear",
        },
      }),
      fill: "none",
      opacity: primitive.opacity,
      stroke: primitive.stroke,
      strokeDasharray: animation === undefined ? primitive.dash : "1",
      ...(animation === undefined ? {} : { strokeDashoffset: 1 }),
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  });
  return (
    <g key={primitive.id}>
      {fill}
      {stroke}
    </g>
  );
}

function renderPrimitiveFill(
  primitive: Exclude<MathVisualPrimitive, { readonly kind: "text" }>,
): React.ReactElement | null {
  if (primitive.kind === "line") return null;
  if (primitive.fill === "none" || primitive.fill === "transparent") return null;
  switch (primitive.kind) {
    case "polyline":
      return primitive.closed ? (
        <polygon
          fill={primitive.fill}
          opacity={primitive.opacity}
          points={primitive.points.map((point) => `${point.x},${point.y}`).join(" ")}
        />
      ) : null;
    case "circle":
      return (
        <circle
          cx={primitive.cx}
          cy={primitive.cy}
          fill={primitive.fill}
          opacity={primitive.opacity}
          r={primitive.radius}
        />
      );
    case "rect":
      return (
        <rect
          fill={primitive.fill}
          height={primitive.height}
          opacity={primitive.opacity}
          width={primitive.width}
          x={primitive.x}
          y={primitive.y}
        />
      );
    case "path":
      return (
        <path
          d={primitive.d}
          fill={primitive.fill}
          opacity={primitive.opacity}
        />
      );
  }
}

function renderPrecisePrimitive(
  primitive: MathVisualPrimitive,
  contentRevealDelayMs?: number,
): React.ReactElement {
  switch (primitive.kind) {
    case "line":
      return (
        <line
          key={primitive.id}
          opacity={primitive.opacity}
          stroke={primitive.stroke}
          strokeDasharray={primitive.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={primitive.strokeWidth}
          x1={primitive.x1}
          x2={primitive.x2}
          y1={primitive.y1}
          y2={primitive.y2}
        />
      );
    case "polyline":
      return (
        <polyline
          key={primitive.id}
          fill={primitive.fill}
          opacity={primitive.opacity}
          points={primitive.points.map((point) => `${point.x},${point.y}`).join(" ")}
          stroke={primitive.stroke}
          strokeDasharray={primitive.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={primitive.strokeWidth}
        />
      );
    case "circle":
      return (
        <circle
          key={primitive.id}
          cx={primitive.cx}
          cy={primitive.cy}
          fill={primitive.fill}
          opacity={primitive.opacity}
          r={primitive.radius}
          stroke={primitive.stroke}
          strokeDasharray={primitive.dash}
          strokeWidth={primitive.strokeWidth}
        />
      );
    case "rect":
      return (
        <rect
          key={primitive.id}
          fill={primitive.fill}
          height={primitive.height}
          opacity={primitive.opacity}
          stroke={primitive.stroke}
          strokeDasharray={primitive.dash}
          strokeWidth={primitive.strokeWidth}
          width={primitive.width}
          x={primitive.x}
          y={primitive.y}
        />
      );
    case "path":
      return (
        <path
          key={primitive.id}
          d={primitive.d}
          fill={primitive.fill}
          opacity={primitive.opacity}
          stroke={primitive.stroke}
          strokeDasharray={primitive.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={primitive.strokeWidth}
        />
      );
    case "text":
      return (
        <text
          key={primitive.id}
          className={contentRevealDelayMs === undefined
            ? undefined
            : "ggulnote-math-deferred-content"}
          fill={primitive.color}
          fontFamily={primitive.fontFamily}
          fontSize={primitive.fontSize}
          fontWeight={primitive.fontWeight}
          opacity={primitive.opacity}
          style={contentRevealDelayMs === undefined ? undefined : {
            animationDelay: `${contentRevealDelayMs}ms`,
            animationDuration: "1ms",
            animationFillMode: "forwards",
            animationName: "ggulnoteMathContentReveal",
            visibility: "hidden",
          }}
          textAnchor={primitive.anchor}
          x={primitive.x}
          y={primitive.y}
        >
          {primitive.text}
        </text>
      );
  }
}

const MATH_ANIMATION_STYLES = `
@keyframes ggulnoteMathStrokeDraw {
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
}
@keyframes ggulnoteMathContentReveal {
  from { visibility: hidden; }
  to { visibility: visible; }
}
@keyframes ggulnoteMathWriteOn {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@media (prefers-reduced-motion: reduce) {
  .ggulnote-math-animated-stroke {
    animation: none !important;
    stroke-dasharray: none !important;
    stroke-dashoffset: 0 !important;
  }
  .ggulnote-math-deferred-content {
    animation: none !important;
    visibility: visible !important;
  }
  .ggulnote-math-write-on-mask {
    animation: none !important;
    transform: scaleX(1) !important;
  }
}
`;
