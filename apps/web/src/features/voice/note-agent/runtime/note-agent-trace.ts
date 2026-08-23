import type { DirectCommandRouteResult } from "../../domain";
import type { NoteDecision, NoteToolId } from "../domain";
import type { NoteRuntimeResult } from "./note-runtime";
import type { ActionTargetGroundingMode } from "../world";

export interface NoteAgentShadowTrace {
  readonly runtimeOwner: "note-agent-v2";
  readonly decisionSchemaVersion: string;
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
  readonly decisionCallCount?: 0 | 1 | 2;
  readonly toolCallCount: number;
  readonly contextAssemblyMs?: number;
  readonly tldrawProjectionMs?: number;
  readonly objectCatalogBuildMs?: number;
  readonly objectCatalogObjectCount?: number;
  readonly objectCatalogSerializedChars?: number;
  readonly visualContextRequested?: boolean;
  readonly visualContextAttached?: boolean;
  readonly visualContextCaptureMs?: number;
  readonly visualContextFailureReason?: string;
  readonly markedScreenshotObjectCount?: number;
  readonly markedScreenshotHandles?: readonly `O${number}`[];
  readonly catalogHandles?: readonly `O${number}`[];
  readonly selectedHandle?: `O${number}`;
  readonly decisionStatus?: NoteDecision["status"];
  readonly decisionAction?: NoteToolId;
  readonly decisionPlacement?: import("../domain").CanvasPlacement;
  readonly groundingMode?: ActionTargetGroundingMode;
  readonly resolvedTargetHandle?: `O${number}`;
  readonly resolvedCanvasBounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly finalLocalOperation?: NoteToolId;
  readonly legacyPlannerInvoked: false;
  readonly fuzzyObjectSelectorInvoked: false;
  readonly decisionMs: number;
  readonly decisionTotalMs?: number;
  readonly openaiTtfbMs?: number;
  readonly openaiBodyReadMs?: number;
  readonly decisionJsonParseMs?: number;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly outputTokens?: number;
  readonly runtimeMs: number;
  readonly prepareMs?: number;
  readonly worldResolveMs?: number;
  readonly resolverMs?: number;
  readonly computeMs?: number;
  readonly placementMs?: number;
  readonly disambiguationMs?: number;
  readonly visualMs?: number;
  readonly visualFallbackMs?: number;
  readonly visualCallCount?: 0 | 1;
  readonly guardMs?: number;
  readonly commitMs?: number;
  readonly endToVisibleMs?: number;
  readonly renderMs?: number;
  readonly usedAmbiguityPass?: boolean;
  readonly usedVisualFallback?: boolean;
  readonly totalMs: number;
  readonly commitAttempted: boolean;
  readonly recordedAt: number;
}
export class NoteAgentShadowTraceStore {
  private readonly traces: NoteAgentShadowTrace[] = [];
  private readonly listeners = new Set<() => void>();

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
    this.emit();
  }

  public getAll(): readonly NoteAgentShadowTrace[] {
    return Object.freeze(this.traces.map((trace) => ({ ...trace })));
  }

  public clear(): void {
    if (this.traces.length === 0) return;
    this.traces.length = 0;
    this.emit();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Diagnostics observers cannot affect Note Agent execution.
      }
    }
  }
}
