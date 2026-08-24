import type {
  ActiveVoiceTurnSnapshot,
  CompletedVoiceTurn,
  DirectCommandRouteResult,
  VoiceTurnRecord,
  VoiceTurnControllerState,
} from "../domain";

export interface CompletedVoiceTurnSource {
  subscribe(listener: (state: VoiceTurnControllerState) => void): () => void;
}

export interface CompletedVoiceTurnRoute {
  onSpeechStart?(
    turn: ActiveVoiceTurnSnapshot,
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
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
  private readonly preparedTurnIds = new Set<string>();
  private readonly preparedTurnOrder: string[] = [];
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
    this.preparedTurnIds.clear();
    this.preparedTurnOrder.length = 0;
  }

  private handleState(state: VoiceTurnControllerState): void {
    if (
      !this.disposed
      && state.status === "capturing"
      && !this.preparedTurnIds.has(state.turn.id)
    ) {
      this.remember(state.turn.id, this.preparedTurnIds, this.preparedTurnOrder);
      try {
        void Promise.resolve(this.options.route.onSpeechStart?.(state.turn, {
          signal: this.controller.signal,
        })).catch(() => {
          // Speech-start optimization failures never interrupt recognition.
        });
      } catch {
        // Speech-start optimization failures never interrupt recognition.
      }
    }
    if (
      this.disposed
      || state.status !== "completed"
      || !isCompletedVoiceTurn(state.result)
      || this.deliveredTurnIds.has(state.result.id)
    ) {
      return;
    }
    this.remember(state.result.id, this.deliveredTurnIds, this.deliveredTurnOrder);
    void this.options.route.execute(state.result, {
      signal: this.controller.signal,
    }).catch(() => {
      // A route failure must not break the next Voice Turn.
    });
  }

  private remember(
    turnId: string,
    ids: Set<string>,
    order: string[],
  ): void {
    ids.add(turnId);
    order.push(turnId);
    const maximumDeliveredTurns = 128;
    while (order.length > maximumDeliveredTurns) {
      const expired = order.shift();
      if (expired !== undefined) ids.delete(expired);
    }
  }
}

function isCompletedVoiceTurn(
  turn: VoiceTurnRecord,
): turn is CompletedVoiceTurn {
  return turn.state === "completed";
}
