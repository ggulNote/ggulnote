import type { Rect } from "@ggulnote/editor-core";

export type EntityRef =
  | {
      readonly kind: "OBJECT";
      readonly objectId: string;
    }
  | {
      readonly kind: "TEXT_RANGE";
      readonly rangeId: string;
      readonly objectIds: readonly string[];
      readonly rects: readonly Rect[];
    }
  | {
      readonly kind: "OBJECT_PART";
      readonly objectId: string;
      readonly partId: string;
      readonly bounds?: Rect;
    }
  | {
      readonly kind: "PAGE";
      readonly pageId: string;
    };

export function cloneEntityRef(reference: EntityRef): EntityRef {
  switch (reference.kind) {
    case "OBJECT":
      return { kind: "OBJECT", objectId: reference.objectId };
    case "TEXT_RANGE":
      return {
        kind: "TEXT_RANGE",
        rangeId: reference.rangeId,
        objectIds: [...reference.objectIds],
        rects: reference.rects.map((rect) => ({ ...rect })),
      };
    case "OBJECT_PART":
      return {
        kind: "OBJECT_PART",
        objectId: reference.objectId,
        partId: reference.partId,
        ...(reference.bounds === undefined
          ? {}
          : { bounds: { ...reference.bounds } }),
      };
    case "PAGE":
      return { kind: "PAGE", pageId: reference.pageId };
  }
}
