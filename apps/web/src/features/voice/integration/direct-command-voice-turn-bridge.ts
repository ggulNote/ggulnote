import type {
  CompletedVoiceTurn,
  DirectCommandRouteResult,
  VoiceTurnRecord,
  VoiceTurnControllerState,
} from "../domain";

export interface CompletedVoiceTurnSource {
  subscribe(listener: (state: VoiceTurnControllerState) => void): () => void;
}

export interface CompletedVoiceTurnRoute {
  execute(
    turn: CompletedVoiceTurn,
    options?: { signal?: AbortSignal },
  ): Promise<DirectCommandRouteResult>;
}

export interface DirectCommandVoiceTurnBridgeOptions {
  controller: CompletedVoiceTurnSource;
  route: CompletedVoiceTurnRoute;
}

export class DirectCommandVoiceTurnBridge {
  private readonly controller = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly deliveredTurnIds = new Set<string>();
  private readonly deliveredTurnOrder: string[] = [];
  private disposed = false;

  public constructor(private readonly options: DirectCommandVoiceTurnBridgeOptions) {
    this.unsubscribe = options.controller.subscribe((state) => {
      this.handleState(state);
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.controller.abort();
    this.deliveredTurnIds.clear();
    this.deliveredTurnOrder.length = 0;
  }

  private handleState(state: VoiceTurnControllerState): void {
    if (
      this.disposed
      || state.status !== "completed"
      || !isCompletedVoiceTurn(state.result)
      || this.deliveredTurnIds.has(state.result.id)
    ) {
      return;
    }
    this.remember(state.result.id);
    void this.options.route.execute(state.result, {
      signal: this.controller.signal,
    }).catch(() => {
      // A route failure must not break the next Voice Turn.
    });
  }

  private remember(turnId: string): void {
    this.deliveredTurnIds.add(turnId);
    this.deliveredTurnOrder.push(turnId);
    const maximumDeliveredTurns = 128;
    while (this.deliveredTurnOrder.length > maximumDeliveredTurns) {
      const expired = this.deliveredTurnOrder.shift();
      if (expired !== undefined) this.deliveredTurnIds.delete(expired);
    }
  }
}

function isCompletedVoiceTurn(
  turn: VoiceTurnRecord,
): turn is CompletedVoiceTurn {
  return turn.state === "completed";
}
