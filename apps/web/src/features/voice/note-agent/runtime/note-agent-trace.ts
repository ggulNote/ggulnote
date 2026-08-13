import type { DirectCommandRouteResult } from "../../domain";
import type { NoteDecision, NoteToolId } from "../domain";
import type { NoteRuntimeResult } from "./note-runtime";

export interface NoteAgentShadowTrace {
  readonly turnId: string;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly shadowMode: boolean;
  readonly decision?: NoteDecision;
  readonly toolId?: NoteToolId;
  readonly resolverStatus?: string;
  readonly placementStatus?: string;
  readonly oldRouteStatus?: DirectCommandRouteResult["status"];
  readonly resultStatus: NoteRuntimeResult["status"] | "DECISION_FAILED" | "CONTEXT_FAILED";
  readonly errorCode?: string;
  readonly llmCallCount: 0 | 1 | 2;
  readonly toolCallCount: number;
  readonly decisionMs: number;
  readonly runtimeMs: number;
  readonly resolverMs?: number;
  readonly computeMs?: number;
  readonly placementMs?: number;
  readonly disambiguationMs?: number;
  readonly visualMs?: number;
  readonly guardMs?: number;
  readonly commitMs?: number;
  readonly endToVisibleMs?: number;
  readonly totalMs: number;
  readonly commitAttempted: boolean;
  readonly recordedAt: number;
}
export class NoteAgentShadowTraceStore {
  private readonly traces: NoteAgentShadowTrace[] = [];

  public constructor(private readonly capacity = 64) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Trace capacity must be a positive integer.");
    }
  }

  public record(trace: NoteAgentShadowTrace): void {
    this.traces.push(Object.freeze({ ...trace }));
    if (this.traces.length > this.capacity) {
      this.traces.splice(0, this.traces.length - this.capacity);
    }
  }

  public getAll(): readonly NoteAgentShadowTrace[] {
    return Object.freeze(this.traces.map((trace) => ({ ...trace })));
  }

  public clear(): void {
    this.traces.length = 0;
  }
}
