import type { SessionTimeMs } from "../time/session-time";
import { toSessionTimeMs } from "../time/session-time";

export type InteractionTimeProvider = () => number;

/**
 * Provides a non-decreasing time axis relative to one interaction session.
 *
 * The caller injects the absolute monotonic time provider. A browser adapter
 * can pass `() => performance.now()` without this package touching browser
 * globals at import time.
 */
export class InteractionClock {
  private readonly sessionStartedAt: number;
  private lastSessionTime: SessionTimeMs = toSessionTimeMs(0);

  public constructor(private readonly timeProvider: InteractionTimeProvider) {
    this.sessionStartedAt = this.readProvider();
  }

  public now(): SessionTimeMs {
    const elapsed = Math.max(0, this.readProvider() - this.sessionStartedAt);
    const nextTime = Math.max(this.lastSessionTime, elapsed);

    this.lastSessionTime = toSessionTimeMs(nextTime);
    return this.lastSessionTime;
  }

  private readProvider(): number {
    const value = this.timeProvider();
    if (!Number.isFinite(value)) {
      throw new RangeError("Interaction time provider must return a finite number.");
    }

    return value;
  }
}
