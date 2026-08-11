import type { PlacementCandidateAlias } from "../domain";

export interface DirectMultimodalModelImage {
  readonly dataUrl: string;
  readonly detail: "low" | "high";
}

export interface DirectMultimodalModelRequest {
  readonly instructions: string;
  readonly inputText: string;
  readonly images: readonly DirectMultimodalModelImage[];
  readonly allowedChoices: readonly (PlacementCandidateAlias | "NONE")[];
  readonly maxOutputTokens: number;
}

export interface DirectMultimodalModelTransportOptions {
  readonly signal?: AbortSignal;
}

export interface DirectMultimodalModelTransport {
  generate(
    request: DirectMultimodalModelRequest,
    options?: DirectMultimodalModelTransportOptions,
  ): Promise<string>;
}
