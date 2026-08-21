import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type SvgExportContext,
  type TLBaseShape,
} from "tldraw";

export const NOTE_ANNOTATION_SHAPE_TYPE = "note-annotation" as const;

export interface NoteAnnotationSegment {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type NoteAnnotationShape = TLBaseShape<
  typeof NOTE_ANNOTATION_SHAPE_TYPE,
  {
    w: number;
    h: number;
    annotationType: "underline" | "highlight";
    segments: NoteAnnotationSegment[];
    color: string;
    opacity: number;
    thickness: number;
  }
>;

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [NOTE_ANNOTATION_SHAPE_TYPE]: NoteAnnotationShape["props"];
  }
}

export class NoteAnnotationShapeUtil extends ShapeUtil<NoteAnnotationShape> {
  public static override type = NOTE_ANNOTATION_SHAPE_TYPE;
  public static override props: RecordProps<NoteAnnotationShape> = {
    w: T.number,
    h: T.number,
    annotationType: T.literalEnum("underline", "highlight"),
    segments: T.arrayOf(T.object({
      x: T.number,
      y: T.number,
      width: T.number,
      height: T.number,
    })),
    color: T.string,
    opacity: T.number,
    thickness: T.number,
  };

  public getDefaultProps(): NoteAnnotationShape["props"] {
    return {
      w: 1,
      h: 1,
      annotationType: "underline",
      segments: [],
      color: "#1f2937",
      opacity: 1,
      thickness: 2,
    };
  }

  public getGeometry(shape: NoteAnnotationShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  public component(shape: NoteAnnotationShape) {
    const { annotationType, color, opacity, segments, thickness } = shape.props;
    return (
      <HTMLContainer style={{ pointerEvents: "none" }}>
        <svg
          aria-hidden="true"
          height="100%"
          overflow="visible"
          width="100%"
        >
          {segments.map((segment, index) => annotationType === "highlight" ? (
            <rect
              key={index}
              fill={color}
              height={segment.height}
              opacity={opacity}
              width={segment.width}
              x={segment.x}
              y={segment.y}
            />
          ) : (
            <line
              key={index}
              opacity={opacity}
              stroke={color}
              strokeLinecap="round"
              strokeWidth={thickness}
              x1={segment.x}
              x2={segment.x + segment.width}
              y1={segment.y + segment.height}
              y2={segment.y + segment.height}
            />
          ))}
        </svg>
      </HTMLContainer>
    );
  }

  public toSvg(shape: NoteAnnotationShape, _context: SvgExportContext) {
    const { annotationType, color, opacity, segments, thickness } = shape.props;
    return (
      <g>
        {segments.map((segment, index) => annotationType === "highlight" ? (
          <rect
            key={index}
            fill={color}
            height={segment.height}
            opacity={opacity}
            width={segment.width}
            x={segment.x}
            y={segment.y}
          />
        ) : (
          <line
            key={index}
            opacity={opacity}
            stroke={color}
            strokeLinecap="round"
            strokeWidth={thickness}
            x1={segment.x}
            x2={segment.x + segment.width}
            y1={segment.y + segment.height}
            y2={segment.y + segment.height}
          />
        ))}
      </g>
    );
  }

  public getIndicatorPath(shape: NoteAnnotationShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
