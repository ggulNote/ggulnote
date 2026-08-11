import type { MultimodalPlacementRequest } from "../domain";
import type { DirectMultimodalModelRequest } from "./direct-multimodal-model-transport";

const INSTRUCTIONS = `You are a bounded spatial placement judge.
Choose exactly one currently supplied candidate alias or NONE.
Use the global overview for page balance and the local marked crop for visual relationships.
Prefer the user's requested relation, semantic connection to the anchor, readability, visual naturalness, and avoiding unnecessary obstruction.
All supplied candidates already passed deterministic geometry constraints. Do not validate or change their geometry.
Do not propose a new position. Do not return coordinates, sizes, object IDs, confidence, reasons, or prose.
Return exactly one JSON object with exactly one field: {"choice":"S1"} or {"choice":"NONE"}.`;

export function buildMultimodalPlacementModelRequest(
  request: MultimodalPlacementRequest,
): DirectMultimodalModelRequest {
  const metadata = {
    observationId: request.observationId,
    pageId: request.pageId,
    sceneRevision: request.sceneRevision,
    instruction: request.instruction,
    draft: request.draft,
    ...(request.anchor === undefined ? {} : { anchor: request.anchor }),
    candidates: request.candidates,
  };
  return {
    instructions: INSTRUCTIONS,
    inputText: JSON.stringify(metadata),
    images: Object.freeze([
      Object.freeze({ dataUrl: request.images.globalOverview, detail: "low" as const }),
      Object.freeze({ dataUrl: request.images.localCandidateCrop, detail: "high" as const }),
    ]),
    allowedChoices: Object.freeze([
      ...request.candidates.map((candidate) => candidate.alias),
      "NONE" as const,
    ]),
    maxOutputTokens: 32,
  };
}
