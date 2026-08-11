import {
  DEFAULT_ANNOTATION_STYLE,
  type Annotation,
  LineAnnotation,
  ShapeAnnotation,
  TableAnnotation,
  TextAnnotation,
  HighlightAnnotation,
  UnderlineAnnotation,
  type AnnotationRenderer,
  type RenderFrameContext,
} from "@ggulnote/editor-core";
import type { NormalizedRect } from "@ggulnote/shared-types";
import type { CanvasRenderContext } from "./canvas-render-context";
import { CanvasSizeController } from "./canvas-size-controller";

class NativeCanvasRenderer implements AnnotationRenderer {
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private pageWidth = 1;
  private pageHeight = 1;

  public beginFrame(context: RenderFrameContext & CanvasRenderContext): void {
    if (!this.ctx) {
      return;
    }

    this.dpr = context.dpr > 0 ? context.dpr : 1;
    this.pageWidth = context.pageSize.width;
    this.pageHeight = context.pageSize.height;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.save();
    this.ctx.scale(this.dpr, this.dpr);
  }

  public render(annotation: Annotation): void {
    if (!this.ctx) {
      return;
    }

    switch (annotation.type) {
      case "TEXT":
        this.renderText(annotation as TextAnnotation);
        break;
      case "UNDERLINE":
        this.renderUnderline(annotation as UnderlineAnnotation);
        break;
      case "HIGHLIGHT":
        this.renderHighlight(annotation as HighlightAnnotation);
        break;
      case "SHAPE":
        this.renderShape(annotation as ShapeAnnotation);
        break;
      case "LINE":
        this.renderLine(annotation as LineAnnotation);
        break;
      case "TABLE":
        this.renderTable(annotation as TableAnnotation);
        break;
      default:
        break;
    }
  }

  public renderSelection(annotation: Annotation): void {
    if (!this.ctx) {
      return;
    }

    const rect = annotation.bounds;
    const x = rect.x * this.pageWidth;
    const y = rect.y * this.pageHeight;
    const width = rect.width * this.pageWidth;
    const height = rect.height * this.pageHeight;
    const handleSize = 6;
    const offset = handleSize / 2;

    this.ctx.save();
    this.ctx.setLineDash([4, 3]);
    this.ctx.strokeStyle = DEFAULT_ANNOTATION_STYLE.selection;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, width, height);

    this.ctx.fillStyle = DEFAULT_ANNOTATION_STYLE.selection;
    const handles = [
      { x, y },
      { x: x + width, y },
      { x, y: y + height },
      { x: x + width, y: y + height },
    ];

    for (const handle of handles) {
      this.ctx.fillRect(handle.x - offset, handle.y - offset, handleSize, handleSize);
    }

    this.ctx.restore();
  }

  public endFrame(): void {
    if (!this.ctx) {
      return;
    }

    this.ctx.restore();
  }

  public setCanvas(canvas: HTMLCanvasElement): void {
    this.ctx = canvas.getContext("2d");
  }

  public setSize(cssWidth: number, cssHeight: number, dpr?: number): void {
    const metrics = CanvasSizeController.compute(cssWidth, cssHeight);
    this.dpr = Number.isFinite(dpr as number) && (dpr as number) > 0 ? (dpr as number) : metrics.dpr;

    if (!this.ctx) {
      return;
    }

    const canvas = this.ctx.canvas;
    const widthPx = Math.max(1, Math.round(metrics.cssWidth * this.dpr));
    const heightPx = Math.max(1, Math.round(metrics.cssHeight * this.dpr));

    canvas.style.width = `${Math.max(1, metrics.cssWidth)}px`;
    canvas.style.height = `${Math.max(1, metrics.cssHeight)}px`;
    canvas.width = widthPx;
    canvas.height = heightPx;
  }

  private parseColor(color: string): string {
    if (!color) {
      return DEFAULT_ANNOTATION_STYLE.stroke;
    }

    return color;
  }

  private renderText(annotation: TextAnnotation): void {
    if (!this.ctx) {
      return;
    }

    const rect = this.toCanvasRect(annotation.bounds);
    const lineHeight = Math.max(10, Number(annotation.fontSize) || 12) * 1.2;
    const fontSize = Math.max(10, Number(annotation.fontSize) || 12);

    this.ctx.save();
    this.ctx.strokeStyle = DEFAULT_ANNOTATION_STYLE.text;
    this.ctx.fillStyle = "rgba(255,255,255,0.02)";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    this.ctx.beginPath();
    this.ctx.rect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2));
    this.ctx.clip();

    this.ctx.fillStyle = this.parseColor(annotation.textColor);
    this.ctx.font = `${annotation.textFontWeight} ${fontSize}px "${annotation.textFontFamily}", Arial, sans-serif`;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "top";

    let y = rect.y + 2;
    const lines = this.wrapText(annotation.text ?? "", rect.width - 4, fontSize, this.ctx.font);
    for (const line of lines) {
      if (y - rect.y > rect.height - lineHeight) {
        break;
      }

      this.ctx.fillText(line, rect.x + 2, y);
      y += lineHeight;
    }

    this.ctx.restore();
  }

  private wrapText(text: string, maxWidth: number, fontSize: number, font: string): string[] {
    if (!this.ctx) {
      return [text];
    }

    const lines: string[] = [];
    const max = Math.max(1, maxWidth);
    const paragraphs = text.split("\n");
    this.ctx.font = font;

    for (const paragraph of paragraphs) {
      const words = paragraph.length > 0 ? paragraph.split(/\s+/) : [""];
      let currentLine = "";

      for (const word of words) {
        const candidate = currentLine.length > 0 ? `${currentLine} ${word}` : word;

        if (this.ctx.measureText(candidate).width > max && currentLine.length > 0) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = candidate;
        }
      }

      lines.push(currentLine);
    }

    return lines;
  }

  private renderUnderline(annotation: UnderlineAnnotation): void {
    if (!this.ctx) {
      return;
    }

    this.ctx.save();
    this.ctx.strokeStyle = this.parseColor(annotation.color);
    this.ctx.lineWidth = Math.max(1, annotation.thickness);
    this.ctx.beginPath();
    for (const bounds of annotation.getRects()) {
      const rect = this.toCanvasRect(bounds);
      const y = rect.y + rect.height;
      this.ctx.moveTo(rect.x, y);
      this.ctx.lineTo(rect.x + rect.width, y);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  private renderHighlight(annotation: HighlightAnnotation): void {
    if (!this.ctx) {
      return;
    }

    this.ctx.save();
    this.ctx.fillStyle = this.colorWithOpacity(annotation.color, annotation.opacity);
    for (const bounds of annotation.getRects()) {
      const rect = this.toCanvasRect(bounds);
      this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    this.ctx.restore();
  }

  private renderShape(shape: ShapeAnnotation): void {
    if (!this.ctx) {
      return;
    }

    const rect = this.toCanvasRect(shape.bounds);

    this.ctx.save();
    this.ctx.strokeStyle = this.parseColor(shape.strokeColor);
    this.ctx.lineWidth = Math.max(1, shape.strokeWidth);

    if (shape.shape === "ellipse") {
      this.ctx.beginPath();
      this.ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(1, rect.width / 2), Math.max(1, rect.height / 2), 0, 0, Math.PI * 2);
      if (shape.filled) {
        this.ctx.fillStyle = this.parseColor(shape.fillColor);
        this.ctx.fill();
      }
      this.ctx.stroke();
    } else {
      if (shape.filled) {
        this.ctx.fillStyle = this.parseColor(shape.fillColor);
        this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }

    this.ctx.restore();
  }

  private renderLine(annotation: LineAnnotation): void {
    if (!this.ctx) {
      return;
    }

    const start = {
      x: annotation.start.x * this.pageWidth,
      y: annotation.start.y * this.pageHeight,
    };
    const end = {
      x: annotation.end.x * this.pageWidth,
      y: annotation.end.y * this.pageHeight,
    };

    this.ctx.save();
    this.ctx.strokeStyle = this.parseColor(annotation.color);
    this.ctx.lineWidth = annotation.strokeWidth;
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.lineTo(end.x, end.y);
    this.ctx.stroke();

    if (annotation.lineKind === "arrow") {
      const head = 8;
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      this.ctx.beginPath();
      this.ctx.moveTo(end.x, end.y);
      this.ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
      this.ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
      this.ctx.closePath();
      this.ctx.fillStyle = this.parseColor(annotation.color);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private renderTable(annotation: TableAnnotation): void {
    if (!this.ctx) {
      return;
    }

    const rect = this.toCanvasRect(annotation.bounds);
    const columns = Math.max(1, annotation.columns);
    const rows = Math.max(1, annotation.rows);
    const cellW = rect.width / columns;
    const cellH = rect.height / rows;

    this.ctx.save();
    this.ctx.strokeStyle = this.parseColor(annotation.strokeColor);
    this.ctx.lineWidth = Math.max(1, annotation.strokeWidth);
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    for (let column = 1; column < columns; column += 1) {
      const x = rect.x + cellW * column;
      this.ctx.beginPath();
      this.ctx.moveTo(x, rect.y);
      this.ctx.lineTo(x, rect.y + rect.height);
      this.ctx.stroke();
    }

    for (let row = 1; row < rows; row += 1) {
      const y = rect.y + cellH * row;
      this.ctx.beginPath();
      this.ctx.moveTo(rect.x, y);
      this.ctx.lineTo(rect.x + rect.width, y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private colorWithOpacity(color: string, opacity: number): string {
    const hexMatch = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(color);
    if (hexMatch) {
      const hex = hexMatch[1];
      const values = hex.length <= 4
        ? hex
            .split("")
            .flatMap((ch) => [ch, ch])
        : hex.split("");

      if (values.length >= 6) {
        const r = Number.parseInt(`${values[0]}${values[1]}`, 16);
        const g = Number.parseInt(`${values[2]}${values[3]}`, 16);
        const b = Number.parseInt(`${values[4]}${values[5]}`, 16);
        const alpha = values.length === 8 ? Number.parseInt(`${values[6]}${values[7]}`, 16) / 255 : 1;

        return `rgba(${r}, ${g}, ${b}, ${opacity * alpha})`;
      }
    }

    const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(color);
    if (rgbMatch) {
      const items = rgbMatch[1].split(",").map((item) => item.trim());
      if (items.length >= 3) {
        const [r, g, b] = items;
        const parsed = [r, g, b].map((value) => Number.parseFloat(value));
        if (parsed.every((num) => Number.isFinite(num))) {
          const alpha = items.length >= 4 ? Number.parseFloat(items[3]) : 1;
          return `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${opacity * (Number.isFinite(alpha) ? alpha : 1)})`;
        }
      }
    }

    return `${color}`;
  }

  private toCanvasRect(rect: NormalizedRect): NormalizedRect {
    return {
      x: rect.x * this.pageWidth,
      y: rect.y * this.pageHeight,
      width: rect.width * this.pageWidth,
      height: rect.height * this.pageHeight,
    };
  }
}

export { NativeCanvasRenderer };
