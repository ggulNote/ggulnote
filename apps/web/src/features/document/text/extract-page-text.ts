import type {
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { PageTextContent, TextDirection } from "../model/document-types";

type TextItemLike = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  fontName?: unknown;
  dir?: unknown;
};

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const MIN_TEXT_ITEM_AREA = 0.000001;

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

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
};

const toNumberArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  if (value.length < 6) {
    return null;
  }

  const numbers = value.slice(0, 6).map((item) => {
    const n = Number(item);
    return Number.isFinite(n) ? n : NaN;
  });

  if (numbers.some((n) => !Number.isFinite(n))) {
    return null;
  }

  return numbers;
};

const toPositiveNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const asTextItem = (item: unknown): item is TextItem => {
  return (
    Boolean(item) &&
    typeof (item as TextItemLike).str === "string" &&
    Array.isArray((item as TextItemLike).transform)
  );
};

const toRect = (item: TextItemLike, pageSize: { width: number; height: number }) => {
  const values = toNumberArray(item.transform);
  if (!values) {
    return null;
  }

  const [a, b, c, d, e, f] = values;

  if (!Number.isFinite(pageSize.width) || !Number.isFinite(pageSize.height)) {
    return null;
  }

  if (pageSize.width <= 0 || pageSize.height <= 0) {
    return null;
  }

  const horizontalScale = Math.hypot(a, b);
  const verticalScale = Math.hypot(c, d);
  const itemWidth = toPositiveNumber(item.width) ?? horizontalScale;
  const itemHeight = toPositiveNumber(item.height) ?? (verticalScale || horizontalScale);

  if (itemWidth <= 0 || itemHeight <= 0) {
    return null;
  }

  const horizontalX = horizontalScale > 0 ? a / horizontalScale : 1;
  const horizontalY = horizontalScale > 0 ? b / horizontalScale : 0;
  const verticalX = verticalScale > 0 ? c / verticalScale : -horizontalY;
  const verticalY = verticalScale > 0 ? d / verticalScale : horizontalX;
  const widthX = horizontalX * itemWidth;
  const widthY = horizontalY * itemWidth;
  const heightX = verticalX * itemHeight;
  const heightY = verticalY * itemHeight;

  const ptsX = [e, e + widthX, e + heightX, e + widthX + heightX];
  const ptsY = [f, f + widthY, f + heightY, f + widthY + heightY];

  const minX = Math.min(...ptsX);
  const maxX = Math.max(...ptsX);
  const minY = Math.min(...ptsY);
  const maxY = Math.max(...ptsY);

  const rectWidth = maxX - minX;
  const rectHeight = maxY - minY;

  if (!Number.isFinite(rectWidth) || !Number.isFinite(rectHeight) || rectWidth <= 0 || rectHeight <= 0) {
    return null;
  }

  const x = minX / pageSize.width;
  const y = 1 - (maxY / pageSize.height);
  const width = rectWidth / pageSize.width;
  const height = rectHeight / pageSize.height;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const raw = { x, y, width, height };
  if (!intersectsUnitRect(raw)) {
    return null;
  }

  const normalized = clampRectToUnit(raw);
  if (normalized.width <= 0 || normalized.height <= 0) {
    return null;
  }

  if (normalized.width * normalized.height < MIN_TEXT_ITEM_AREA) {
    return null;
  }

  return normalized;
};

const normalizeText = (text: string): string => text
  .replace(/\u00a0/g, " ")
  .replace(/\s+/gu, " ")
  .trim();

const toDirection = (value: unknown): TextDirection | undefined => {
  if (value === "rtl" || value === "ttb" || value === "ltr") {
    return value;
  }

  return undefined;
};

export async function extractPageTextContent(
  page: PDFPageProxy,
  pageNumber: number,
  pageSize: { width: number; height: number },
): Promise<PageTextContent> {
  const textContent: TextContent = await page.getTextContent({ includeMarkedContent: false });

  const items = textContent.items
    .map((rawItem, index) => {
      if (!asTextItem(rawItem)) {
        return null;
      }

      const item = rawItem as TextItemLike & Pick<TextItem, "str" | "transform" | "width" | "height" | "fontName" | "dir">;
      const rawText = item.str ?? "";
      const text = normalizeText(String(rawText));
      if (text.length <= 0) {
        return null;
      }

      const bounds = toRect(item, pageSize);
      if (!bounds) {
        return null;
      }

      const pageHeight = pageSize.height;
      const estimatedFontSize = pageHeight > 0
        ? bounds.height * pageHeight
        : 0;

      return {
        id: `${pageNumber}-${index}-${text}`,
        text,
        bounds,
        sourceIndex: index,
        fontName: typeof item.fontName === "string" ? item.fontName : undefined,
        direction: toDirection(item.dir),
        fontSize: estimatedFontSize > 0 ? estimatedFontSize : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    pageNumber,
    items,
  };
}
