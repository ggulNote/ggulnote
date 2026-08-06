import type { ScenePage } from "./types";

export type CompositeRenderedImage = Blob | string;

export interface CompositeRenderInput {
  pageId: string;
  page: ScenePage;
  sceneRevision: number;
  renderImage: () => Promise<CompositeRenderedImage>;
  getCurrentSceneRevision: () => number;
}

export interface CompositeRenderSnapshot {
  sceneRevision: number;
  pageId: string;
  width: number;
  height: number;
  image: CompositeRenderedImage;
  generatedAt: number;
  stale: boolean;
}

export interface CompositeRenderFailure {
  kind: "failure";
  pageId: string;
  sceneRevision: number;
  generatedAt: number;
  error: unknown;
}

export interface CompositeRenderResult {
  snapshot?: CompositeRenderSnapshot;
  failure?: CompositeRenderFailure;
}

export const buildCompositeRenderSnapshot = async (
  input: CompositeRenderInput,
): Promise<CompositeRenderResult> => {
  const startedRevision = input.sceneRevision;
  const generatedAt = Date.now();

  try {
    const image = await input.renderImage();

    const currentRevision = sanitizeRevision(input.getCurrentSceneRevision());
    const pageWidth = normalizeDimension(input.page.width);
    const pageHeight = normalizeDimension(input.page.height);

    return {
      snapshot: {
        sceneRevision: startedRevision,
        pageId: input.pageId,
        width: pageWidth,
        height: pageHeight,
        image,
        generatedAt,
        stale: currentRevision !== startedRevision,
      },
    };
  } catch (error) {
    return {
      failure: {
        kind: "failure",
        pageId: input.pageId,
        sceneRevision: startedRevision,
        generatedAt,
        error,
      },
    };
  }
};

const sanitizeRevision = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const normalizeDimension = (value: number): number => {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};
