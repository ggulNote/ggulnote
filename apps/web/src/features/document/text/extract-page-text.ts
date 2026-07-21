import type {
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { PageTextContent } from "../model/document-types";

type TextItemLike = {
  str?: unknown;
  transform?: unknown;
  fontName?: unknown;
  dir?: unknown;
};

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

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

  const ptsX = [e, a + e, c + e, a + c + e];
  const ptsY = [f, b + f, d + f, b + d + f];

  const minX = Math.min(...ptsX);
  const maxX = Math.max(...ptsX);
  const minY = Math.min(...ptsY);
  const maxY = Math.max(...ptsY);

  const rectWidth = maxX - minX;
  const rectHeight = maxY - minY;

  if (!Number.isFinite(rectWidth) || !Number.isFinite(rectHeight) || rectWidth <= 0 || rectHeight <= 0) {
    return null;
  }

  const x = clamp(minX / pageSize.width);
  const y = clamp(1 - maxY / pageSize.height);
  const width = clamp((maxX - minX) / pageSize.width);
  const height = clamp((maxY - minY) / pageSize.height);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
};

export async function extractPageTextContent(
  page: PDFPageProxy,
  pageNumber: number,
  pageSize: { width: number; height: number },
): Promise<PageTextContent> {
  const textContent: TextContent = await page.getTextContent({ includeMarkedContent: false });

  const items = textContent.items
    .filter((item): item is TextItem => {
      if (!asTextItem(item)) {
        return false;
      }

      const trimmed = item.str.trim();
      return trimmed.length > 0;
    })
    .map((item) => {
      const bounds = toRect(item, pageSize);
      if (!bounds) {
        return null;
      }

      return {
        id: `${pageNumber}-${item.str}-${bounds.x}-${bounds.y}`,
        text: item.str,
        bounds,
        fontName: typeof item.fontName === "string" ? item.fontName : undefined,
        direction: typeof item.dir === "string" ? item.dir : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    pageNumber,
    items,
  };
}
