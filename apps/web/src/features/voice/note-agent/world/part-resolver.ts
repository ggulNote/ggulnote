import {
  normalizeSceneObjectText,
  type SceneObjectPartMetadata,
} from "@ggulnote/editor-core";
import type { EntityPartSelector } from "../domain";
import type { EntityRef } from "./entity-ref";
import type { UnifiedObjectWorld } from "./unified-object-world";

export type PartResolutionResult =
  | { readonly status: "RESOLVED"; readonly ref: Extract<EntityRef, { kind: "OBJECT_PART" }> }
  | {
      readonly status: "AMBIGUOUS";
      readonly candidates: readonly {
        readonly label: `C${number}`;
        readonly ref: Extract<EntityRef, { kind: "OBJECT_PART" }>;
        readonly kind: string;
        readonly textPreview?: string;
      }[];
    }
  | { readonly status: "NOT_FOUND" }
  | { readonly status: "UNSUPPORTED"; readonly reasonCode: string };

/** Resolves declarative graph/table/formula parts without accepting an LLM partId. */
export class DeterministicPartResolver {
  public resolve(
    parent: EntityRef,
    selector: EntityPartSelector,
    world: UnifiedObjectWorld,
  ): PartResolutionResult {
    const objectId = parent.kind === "OBJECT" || parent.kind === "OBJECT_PART"
      ? parent.objectId
      : parent.kind === "TEXT_RANGE" && parent.objectIds.length === 1
        ? parent.objectIds[0]
        : undefined;
    if (objectId === undefined) {
      return { status: "UNSUPPORTED", reasonCode: "PART_PARENT_UNSUPPORTED" };
    }
    const metadata = world.getObjectMetadata(objectId);
    if (metadata?.capabilities.partAddressable !== true) {
      return { status: "UNSUPPORTED", reasonCode: "PART_NOT_ADDRESSABLE" };
    }
    const parts = (metadata.parts ?? []).filter((part) => matchesPart(part, selector));
    if (parts.length === 0) return { status: "NOT_FOUND" };
    if (parts.length === 1) {
      const part = parts[0];
      return {
        status: "RESOLVED",
        ref: {
          kind: "OBJECT_PART",
          objectId,
          partId: part.partId,
          ...(part.bounds === undefined ? {} : { bounds: { ...part.bounds } }),
        },
      };
    }
    return {
      status: "AMBIGUOUS",
      candidates: parts.slice(0, 6).map((part, index) => ({
        label: `C${index + 1}` as const,
        ref: {
          kind: "OBJECT_PART",
          objectId,
          partId: part.partId,
          ...(part.bounds === undefined ? {} : { bounds: { ...part.bounds } }),
        },
        kind: part.kind,
        ...(part.searchableText === undefined
          ? {}
          : { textPreview: part.searchableText.slice(0, 160) }),
      })),
    };
  }
}

function matchesPart(
  part: SceneObjectPartMetadata,
  selector: EntityPartSelector,
): boolean {
  if (part.kind !== selector.kind) return false;
  if (selector.index !== undefined && part.attributes?.index !== selector.index) return false;
  if (selector.row !== undefined && part.attributes?.row !== selector.row) return false;
  if (selector.column !== undefined && part.attributes?.column !== selector.column) return false;
  if (selector.text !== undefined) {
    const text = part.searchableText;
    if (text === undefined || !normalizeSceneObjectText(text).includes(
      normalizeSceneObjectText(selector.text),
    )) return false;
  }
  return true;
}
