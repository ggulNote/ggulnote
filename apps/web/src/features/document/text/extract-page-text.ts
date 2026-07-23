import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type {
  LocalTextAxis,
  PageTextContent,
  TextDirection,
  TextOrientation,
  TextQuad,
} from "../model/document-types";

type TextItemLike = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  fontName?: unknown;
  dir?: unknown;
  hasEOL?: unknown;
};

type TextGeometry = {
  bounds: { x: number; y: number; width: number; height: number };
  transform: [number, number, number, number, number, number];
  pdfWidth: number;
  pdfHeight: number;
  orientation: TextOrientation;
  axis: LocalTextAxis;
  quad: TextQuad;
};

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const MIN_TEXT_ITEM_AREA = 0.000001;
const HORIZONTAL_ANGLE_TOLERANCE = Math.PI / 24;

const intersectsUnitRect = (rect: { x: number; y: number; width: number; height: number }): boolean => {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return right > 0 && bottom > 0 && rect.x < 1 && rect.y < 1;
};

const clampRectToUnit = (rect: { x: number; y: number; width: number; height: number }) => {
  const x1 = clamp(rect.x);
  const y1 = clamp(rect.y);
  const x2 = clamp(rect.x + rect.width);
  const y2 = clamp(rect.y + rect.height);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
};

const toTransform = (
  value: unknown,
): [number, number, number, number, number, number] | null => {
  if (!Array.isArray(value) || value.length < 6) return null;
  const values = value.slice(0, 6).map(Number);
  if (values.some((entry) => !Number.isFinite(entry))) return null;
  return values as [number, number, number, number, number, number];
};

const toPositiveNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const normalizeVector = (x: number, y: number, fallbackX: number, fallbackY: number) => {
  const length = Math.hypot(x, y);
  return !Number.isFinite(length) || length <= Number.EPSILON
    ? { x: fallbackX, y: fallbackY }
    : { x: x / length, y: y / length };
};

const normalizeAngle = (angle: number): number => {
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  if (normalized <= -Math.PI) normalized += Math.PI * 2;
  return Math.abs(normalized) < 1e-10 ? 0 : normalized;
};

const angleDistance = (left: number, right: number): number => {
  return Math.abs(normalizeAngle(left - right));
};

const asTextItem = (item: unknown): item is TextItem => {
  return Boolean(item)
    && typeof (item as TextItemLike).str === "string"
    && Array.isArray((item as TextItemLike).transform);
};

const toGeometry = (
  item: TextItemLike,
  pageSize: { width: number; height: number },
): TextGeometry | null => {
  const transform = toTransform(item.transform);
  if (
    !transform
    || !Number.isFinite(pageSize.width)
    || !Number.isFinite(pageSize.height)
    || pageSize.width <= 0
    || pageSize.height <= 0
  ) {
    return null;
  }

  const [a, b, c, d, e, f] = transform;
  const horizontalScale = Math.hypot(a, b);
  const verticalScale = Math.hypot(c, d);
  const itemWidth = toPositiveNumber(item.width) ?? horizontalScale;
  const itemHeight = toPositiveNumber(item.height) ?? (verticalScale || horizontalScale);
  if (itemWidth <= 0 || itemHeight <= 0 || horizontalScale <= 0) return null;

  const horizontalX = a / horizontalScale;
  const horizontalY = b / horizontalScale;
  const verticalX = verticalScale > 0 ? c / verticalScale : -horizontalY;
  const verticalY = verticalScale > 0 ? d / verticalScale : horizontalX;
  const advance = {
    x: horizontalX * itemWidth / pageSize.width,
    y: -horizontalY * itemWidth / pageSize.height,
  };
  const normal = {
    x: verticalX * itemHeight / pageSize.width,
    y: -verticalY * itemHeight / pageSize.height,
  };
  const origin = { x: e / pageSize.width, y: 1 - f / pageSize.height };
  const rawPoints = [
    origin,
    { x: origin.x + advance.x, y: origin.y + advance.y },
    { x: origin.x + advance.x + normal.x, y: origin.y + advance.y + normal.y },
    { x: origin.x + normal.x, y: origin.y + normal.y },
  ] as const;
  const minX = Math.min(...rawPoints.map((point) => point.x));
  const minY = Math.min(...rawPoints.map((point) => point.y));
  const maxX = Math.max(...rawPoints.map((point) => point.x));
  const maxY = Math.max(...rawPoints.map((point) => point.y));
  const rawBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  if (!intersectsUnitRect(rawBounds) || rawBounds.width <= 0 || rawBounds.height <= 0) return null;
  const bounds = clampRectToUnit(rawBounds);
  if (
    bounds.width <= 0
    || bounds.height <= 0
    || bounds.width * bounds.height < MIN_TEXT_ITEM_AREA
  ) {
    return null;
  }

  const angle = normalizeAngle(Math.atan2(b, a));
  const horizontalDistance = Math.min(angleDistance(angle, 0), angleDistance(angle, Math.PI));
  const orientation: TextOrientation = {
    angle,
    writingMode: item.dir === "ttb"
      ? "vertical"
      : horizontalDistance <= HORIZONTAL_ANGLE_TOLERANCE
        ? "horizontal"
        : "rotated",
  };
  const advanceUnit = normalizeVector(advance.x, advance.y, Math.cos(-angle), Math.sin(-angle));
  const normalUnit = normalizeVector(normal.x, normal.y, -advanceUnit.y, advanceUnit.x);

  return {
    bounds,
    transform,
    pdfWidth: itemWidth,
    pdfHeight: itemHeight,
    orientation,
    axis: {
      advanceX: advanceUnit.x,
      advanceY: advanceUnit.y,
      normalX: normalUnit.x,
      normalY: normalUnit.y,
    },
    quad: {
      points: rawPoints.map((point) => ({
        x: clamp(point.x),
        y: clamp(point.y),
      })) as TextQuad["points"],
    },
  };
};

const normalizeText = (text: string): string => text
  .replace(/\u00a0/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

const toDirection = (value: unknown): TextDirection | undefined => {
  return value === "rtl" || value === "ttb" || value === "ltr" ? value : undefined;
};

export async function extractPageTextContent(
  page: PDFPageProxy,
  pageNumber: number,
  pageSize: { width: number; height: number },
): Promise<PageTextContent> {
  const textContent: TextContent = await page.getTextContent({ includeMarkedContent: false });
  const items = textContent.items
    .map((rawItem, index) => {
      if (!asTextItem(rawItem)) return null;

      const item = rawItem as TextItemLike & Pick<
        TextItem,
        "str" | "transform" | "width" | "height" | "fontName" | "dir" | "hasEOL"
      >;
      const text = normalizeText(String(item.str ?? ""));
      if (!text) return null;

      const geometry = toGeometry(item, pageSize);
      if (!geometry) return null;

      return {
        id: String(pageNumber) + "-" + String(index) + "-" + text,
        text,
        bounds: geometry.bounds,
        sourceIndex: index,
        fontName: typeof item.fontName === "string" ? item.fontName : undefined,
        direction: toDirection(item.dir),
        fontSize: geometry.pdfHeight,
        hasEOL: item.hasEOL === true,
        transform: geometry.transform,
        pdfWidth: geometry.pdfWidth,
        pdfHeight: geometry.pdfHeight,
        orientation: geometry.orientation,
        axis: geometry.axis,
        quad: geometry.quad,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { pageNumber, items };
}
