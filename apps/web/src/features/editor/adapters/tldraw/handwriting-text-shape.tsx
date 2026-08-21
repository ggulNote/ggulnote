import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type SvgExportContext,
  type TLBaseShape,
} from "tldraw";
import {
  HANDWRITING_FONT_STACK,
  readWriteOn,
} from "./write-on-presentation";

export const HANDWRITING_TEXT_SHAPE_TYPE = "ggulnote-text" as const;
export const HANDWRITING_TEXT_FONT_SIZE = 30;

export type HandwritingTextShape = TLBaseShape<
  typeof HANDWRITING_TEXT_SHAPE_TYPE,
  {
    w: number;
    h: number;
    text: string;
    fontSize: number;
  }
>;

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [HANDWRITING_TEXT_SHAPE_TYPE]: HandwritingTextShape["props"];
  }
}

export class HandwritingTextShapeUtil extends ShapeUtil<HandwritingTextShape> {
  public static override type = HANDWRITING_TEXT_SHAPE_TYPE;
  public static override props: RecordProps<HandwritingTextShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
    fontSize: T.number,
  };

  public getDefaultProps(): HandwritingTextShape["props"] {
    return {
      w: 1,
      h: 1,
      text: "",
      fontSize: HANDWRITING_TEXT_FONT_SIZE,
    };
  }

  public getGeometry(shape: HandwritingTextShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  public component(shape: HandwritingTextShape) {
    const writeOn = readWriteOn(textAnimationKey(shape.id));
    return (
      <HTMLContainer style={{ pointerEvents: "none" }}>
        {writeOn === undefined ? null : <style>{TEXT_WRITE_ON_STYLES}</style>}
        <div
          className={writeOn === undefined
            ? "ggulnote-handwriting-text"
            : "ggulnote-handwriting-text ggulnote-text-write-on"}
          data-testid="ggulnote-handwriting-text"
          style={{
            color: "#172033",
            fontFamily: HANDWRITING_FONT_STACK,
            fontSize: shape.props.fontSize,
            height: "100%",
            lineHeight: 1.15,
            overflow: "hidden",
            overflowWrap: "anywhere",
            padding: "0 2px",
            whiteSpace: "pre-wrap",
            width: "100%",
            ...(writeOn === undefined ? {} : {
              animationDelay: `${-writeOn.elapsedMs}ms`,
              animationDuration: `${writeOn.durationMs}ms`,
              animationFillMode: "both",
              animationName: "ggulnoteTextWriteOn",
              animationTimingFunction: "cubic-bezier(0.2, 0.75, 0.25, 1)",
            }),
          }}
        >
          {shape.props.text}
        </div>
      </HTMLContainer>
    );
  }

  public toSvg(shape: HandwritingTextShape, _context: SvgExportContext) {
    const lines = shape.props.text.split("\n");
    return (
      <text
        fill="#172033"
        fontFamily={HANDWRITING_FONT_STACK}
        fontSize={shape.props.fontSize}
      >
        {lines.map((line, index) => (
          <tspan
            key={index}
            x={2}
            y={(index + 1) * shape.props.fontSize * 1.15}
          >
            {line}
          </tspan>
        ))}
      </text>
    );
  }

  public getIndicatorPath(shape: HandwritingTextShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

export function textAnimationKey(shapeId: string): string {
  return `text:${shapeId}`;
}

const TEXT_WRITE_ON_STYLES = `
@keyframes ggulnoteTextWriteOn {
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}
@media (prefers-reduced-motion: reduce) {
  .ggulnote-text-write-on {
    animation: none !important;
    clip-path: none !important;
  }
}
`;
