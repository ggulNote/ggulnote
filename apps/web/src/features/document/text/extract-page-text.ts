import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type {
  CanonicalViewportSnapshot,
  LocalTextAxis,
  PageTextContent,
  PageTextDebugSummary,
  RawPdfTextItemDebug,
  TextDirection,
  TextOrientation,
  TextQuad,
} from "../model/document-types";

export interface PageTextExtractionContext {
  documentId: string;
  pageId: string;
  pageNumber: number;
  requestId: number;
}

export interface PdfTextItemGeometryInput {
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  fontName: string;
  dir: string;
  hasEOL: boolean;
}

export interface PdfTextStyleInput {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
}

export interface ComputedTextItemGeometry {
  bounds: { x: number; y: number; width: number; height: number };
  pixelBounds: { x: number; y: number; width: number; height: number };
  angle: number;
  fontHeight: number;
  fontAscent: number;
  orientation: TextOrientation;
  axis: LocalTextAxis;
  quad: TextQuad;
}

type TextItemLike = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  fontName?: unknown;
  dir?: unknown;
  hasEOL?: unknown;
};

type TextStyleLike = {
  ascent?: unknown;
  descent?: unknown;
  vertical?: unknown;
};

const DEFAULT_FONT_ASCENT_RATIO = 0.8;
const HORIZONTAL_ANGLE_TOLERANCE = Math.PI / 24;

const normalizeAngle = (angle: number): number => {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized <= -Math.PI) normalized += Math.PI * 2;
  return Math.abs(normalized) < 1e-10 ? 0 : normalized;
};

const angleDistance = (left: number, right: number): number =>
  Math.abs(normalizeAngle(left - right));

const normalizeVector = (x: number, y: number, fallbackX: number, fallbackY: number) => {
  const length = Math.hypot(x, y);
  return !Number.isFinite(length) || length <= Number.EPSILON
    ? { x: fallbackX, y: fallbackY }
    : { x: x / length, y: y / length };
};

const toTransform = (
  value: unknown,
): [number, number, number, number, number, number] | null => {
  if (!Array.isArray(value) || value.length < 6) return null;
  const values = value.slice(0, 6).map(Number);
  if (values.some((entry) => !Number.isFinite(entry))) return null;
  return values as [number, number, number, number, number, number];
};

const toFiniteNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toPositiveNumber = (value: unknown): number | null => {
  const number = toFiniteNumber(value);
  return number !== null && number > 0 ? number : null;
};

const asTextItem = (item: unknown): item is TextItem =>
  Boolean(item)
  && typeof (item as TextItemLike).str === "string"
  && Array.isArray((item as TextItemLike).transform);

const normalizeText = (text: string): string => text
  .replace(/\u00a0/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

const toDirection = (value: unknown): TextDirection | undefined =>
  value === "rtl" || value === "ttb" || value === "ltr" ? value : undefined;

const multiplyTransforms = (
  left: [number, number, number, number, number, number],
  right: [number, number, number, number, number, number],
): [number, number, number, number, number, number] => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];

const getAscentRatio = (style: PdfTextStyleInput): number => {
  if (Number.isFinite(style.ascent) && style.ascent !== 0) {
    return Number(style.ascent);
  }
  if (Number.isFinite(style.descent) && style.descent !== 0) {
    return 1 + Number(style.descent);
  }
  return DEFAULT_FONT_ASCENT_RATIO;
};

const toAxisAlignedBounds = (
  points: Array<{ x: number; y: number }>,
): { x: number; y: number; width: number; height: number } => {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export function isValidBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): boolean {
  return Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

const intersectsPage = (bounds: { x: number; y: number; width: number; height: number }): boolean =>
  bounds.x + bounds.width > 0
  && bounds.y + bounds.height > 0
  && bounds.x < 1
  && bounds.y < 1;

const isOutOfPage = (bounds: { x: number; y: number; width: number; height: number }): boolean =>
  bounds.x < 0
  || bounds.y < 0
  || bounds.x + bounds.width > 1
  || bounds.y + bounds.height > 1;

export function computePdfTextItemGeometry(
  item: PdfTextItemGeometryInput,
  style: PdfTextStyleInput,
  viewport: CanonicalViewportSnapshot,
): ComputedTextItemGeometry | null {
  if (
    !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
    || !Number.isFinite(viewport.scale)
    || viewport.scale <= 0
    || item.width <= 0
    || item.height <= 0
  ) {
    return null;
  }

  const tx = multiplyTransforms(viewport.transform, item.transform);
  let angle = Math.atan2(tx[1], tx[0]);
  if (style.vertical) angle += Math.PI / 2;
  angle = normalizeAngle(angle);

  const fontHeight = Math.hypot(tx[2], tx[3]);
  const fontAscent = fontHeight * getAscentRatio(style);
  const advanceLength = (style.vertical ? item.height : item.width) * viewport.scale;
  if (
    !Number.isFinite(fontHeight)
    || !Number.isFinite(fontAscent)
    || !Number.isFinite(advanceLength)
    || fontHeight <= 0
    || advanceLength <= 0
  ) {
    return null;
  }

  const left = angle === 0 ? tx[4] : tx[4] + fontAscent * Math.sin(angle);
  const top = angle === 0 ? tx[5] - fontAscent : tx[5] - fontAscent * Math.cos(angle);
  const advance = { x: Math.cos(angle) * advanceLength, y: Math.sin(angle) * advanceLength };
  const normal = { x: -Math.sin(angle) * fontHeight, y: Math.cos(angle) * fontHeight };
  const pixelPoints = [
    { x: left, y: top },
    { x: left + advance.x, y: top + advance.y },
    { x: left + advance.x + normal.x, y: top + advance.y + normal.y },
    { x: left + normal.x, y: top + normal.y },
  ];
  const pixelBounds = toAxisAlignedBounds(pixelPoints);
  const normalizedPoints = pixelPoints.map((point) => ({
    x: point.x / viewport.width,
    y: point.y / viewport.height,
  })) as TextQuad["points"];
  const bounds = toAxisAlignedBounds(normalizedPoints);
  if (!isValidBounds(bounds)) return null;

  const advanceNormalized = { x: advance.x / viewport.width, y: advance.y / viewport.height };
  const normalNormalized = { x: normal.x / viewport.width, y: normal.y / viewport.height };
  const advanceUnit = normalizeVector(
    advanceNormalized.x,
    advanceNormalized.y,
    Math.cos(angle),
    Math.sin(angle),
  );
  const normalUnit = normalizeVector(
    normalNormalized.x,
    normalNormalized.y,
    -advanceUnit.y,
    advanceUnit.x,
  );
  const horizontalDistance = Math.min(angleDistance(angle, 0), angleDistance(angle, Math.PI));
  const orientation: TextOrientation = {
    angle,
    writingMode: item.dir === "ttb" || style.vertical
      ? "vertical"
      : horizontalDistance <= HORIZONTAL_ANGLE_TOLERANCE
        ? "horizontal"
        : "rotated",
  };

  return {
    bounds,
    pixelBounds,
    angle,
    fontHeight,
    fontAscent,
    orientation,
    axis: {
      advanceX: advanceUnit.x,
      advanceY: advanceUnit.y,
      normalX: normalUnit.x,
      normalY: normalUnit.y,
    },
    quad: { points: normalizedPoints },
  };
}

export function createPageScopedTextItemId(
  documentId: string,
  pageId: string,
  sourceIndex: number,
): string {
  return `${encodeURIComponent(documentId)}:${encodeURIComponent(pageId)}:text:${sourceIndex}`;
}

const createViewportSnapshot = (page: PDFPageProxy): CanonicalViewportSnapshot => {
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const transform = toTransform(viewport.transform);
  if (!transform) throw new Error("PDF page viewport transform is invalid");
  return {
    transform,
    scale: viewport.scale,
    rotation: viewport.rotation,
    width: viewport.width,
    height: viewport.height,
    viewBox: Array.from(viewport.viewBox, Number),
    userUnit: Number.isFinite(page.userUnit) ? page.userUnit : undefined,
  };
};

const createRawDebugItem = (
  context: PageTextExtractionContext,
  sourceIndex: number,
  item: PdfTextItemGeometryInput,
  style: PdfTextStyleInput,
  viewport: CanonicalViewportSnapshot,
  geometry: ComputedTextItemGeometry,
): RawPdfTextItemDebug => ({
  ...context,
  sourceIndex,
  str: item.str,
  transform: [...item.transform],
  width: item.width,
  height: item.height,
  fontName: item.fontName,
  dir: item.dir,
  hasEOL: item.hasEOL,
  style: {
    ascent: Number.isFinite(style.ascent) ? Number(style.ascent) : null,
    descent: Number.isFinite(style.descent) ? Number(style.descent) : null,
    vertical: style.vertical === true,
  },
  viewport: { ...viewport, transform: [...viewport.transform], viewBox: [...viewport.viewBox] },
  computed: {
    angle: geometry.angle,
    fontHeight: geometry.fontHeight,
    fontAscent: geometry.fontAscent,
    ...geometry.pixelBounds,
    normalizedBounds: { ...geometry.bounds },
  },
});

export async function extractPageTextContent(
  page: PDFPageProxy,
  context: PageTextExtractionContext,
): Promise<PageTextContent> {
  const viewport = createViewportSnapshot(page);
  const textContent: TextContent = await page.getTextContent({ includeMarkedContent: false });
  const items: PageTextContent["items"] = [];
  const rawItems: RawPdfTextItemDebug[] = [];
  let emptyItemCount = 0;
  let invalidBoundsCount = 0;
  let rotatedItemCount = 0;
  let outOfPageBoundsCount = 0;
  let pdfTextItemCount = 0;

  textContent.items.forEach((rawItem, sourceIndex) => {
    if (!asTextItem(rawItem)) return;
    pdfTextItemCount += 1;
    const transform = toTransform(rawItem.transform);
    const width = toPositiveNumber(rawItem.width);
    const height = toPositiveNumber(rawItem.height);
    if (!transform || width === null || height === null) {
      invalidBoundsCount += 1;
      return;
    }

    const fontName = typeof rawItem.fontName === "string" ? rawItem.fontName : "";
    const rawStyle = textContent.styles[fontName] as TextStyleLike | undefined;
    const style: PdfTextStyleInput = {
      ascent: toFiniteNumber(rawStyle?.ascent) ?? undefined,
      descent: toFiniteNumber(rawStyle?.descent) ?? undefined,
      vertical: rawStyle?.vertical === true,
    };
    const item: PdfTextItemGeometryInput = {
      str: String(rawItem.str ?? ""),
      transform,
      width,
      height,
      fontName,
      dir: typeof rawItem.dir === "string" ? rawItem.dir : "",
      hasEOL: rawItem.hasEOL === true,
    };
    const geometry = computePdfTextItemGeometry(item, style, viewport);
    if (!geometry) {
      invalidBoundsCount += 1;
      return;
    }

    const rawDebug = createRawDebugItem(context, sourceIndex, item, style, viewport, geometry);
    rawItems.push(rawDebug);
    if (geometry.orientation.writingMode !== "horizontal") rotatedItemCount += 1;
    if (isOutOfPage(geometry.bounds)) outOfPageBoundsCount += 1;

    const text = normalizeText(item.str);
    if (!text) {
      emptyItemCount += 1;
      return;
    }
    if (!intersectsPage(geometry.bounds)) return;

    items.push({
      id: createPageScopedTextItemId(context.documentId, context.pageId, sourceIndex),
      documentId: context.documentId,
      pageId: context.pageId,
      pageNumber: context.pageNumber,
      requestId: context.requestId,
      text,
      bounds: { ...geometry.bounds },
      sourceIndex,
      fontName: fontName || undefined,
      direction: toDirection(item.dir),
      fontSize: geometry.fontHeight,
      hasEOL: item.hasEOL,
      transform: [...transform],
      pdfWidth: width,
      pdfHeight: height,
      orientation: { ...geometry.orientation },
      axis: { ...geometry.axis },
      quad: { points: geometry.quad.points.map((point) => ({ ...point })) as TextQuad["points"] },
      rawPdf: rawDebug,
    });
  });

  const debugBounds = rawItems.map((item) => item.computed.normalizedBounds);
  const summary: PageTextDebugSummary = {
    ...context,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    viewportScale: viewport.scale,
    viewportRotation: viewport.rotation,
    itemCount: pdfTextItemCount,
    emptyItemCount,
    invalidBoundsCount,
    rotatedItemCount,
    outOfPageBoundsCount,
    minX: debugBounds.length > 0 ? Math.min(...debugBounds.map((bounds) => bounds.x)) : 0,
    minY: debugBounds.length > 0 ? Math.min(...debugBounds.map((bounds) => bounds.y)) : 0,
    maxRight: debugBounds.length > 0
      ? Math.max(...debugBounds.map((bounds) => bounds.x + bounds.width))
      : 0,
    maxBottom: debugBounds.length > 0
      ? Math.max(...debugBounds.map((bounds) => bounds.y + bounds.height))
      : 0,
  };

  return {
    ...context,
    source: "extracted",
    viewport,
    items,
    rawItems,
    summary,
  };
}