import type { SessionTimeMs } from "../time/session-time";

export interface TimedTimelineEntry {
  readonly time: SessionTimeMs;
}

const INITIAL_CAPACITY = 16;

/**
 * A time-retained ring buffer for entries appended in non-decreasing time order.
 *
 * append throws when an entry is older than the previously appended entry.
 * Entries strictly older than `latest time - retentionDurationMs` are evicted.
 * Query ranges include both endpoints.
 */
export class RingBuffer<TEntry extends TimedTimelineEntry> {
  private storage: Array<TEntry | undefined> = new Array(INITIAL_CAPACITY);
  private head = 0;
  private entryCount = 0;
  private lastAppendedAt: SessionTimeMs | null = null;

  public constructor(public readonly retentionDurationMs: number) {
    if (!Number.isFinite(retentionDurationMs) || retentionDurationMs < 0) {
      throw new RangeError("retentionDurationMs must be a finite, non-negative number.");
    }
  }

  public get size(): number {
    return this.entryCount;
  }

  public append(entry: TEntry): void {
    this.assertValidTime(entry.time);
    if (this.lastAppendedAt !== null && entry.time < this.lastAppendedAt) {
      throw new RangeError("RingBuffer entries must be appended in non-decreasing time order.");
    }

    this.ensureCapacity();
    const tail = (this.head + this.entryCount) % this.storage.length;
    this.storage[tail] = entry;
    this.entryCount += 1;
    this.lastAppendedAt = entry.time;
    this.evictOlderThan(entry.time - this.retentionDurationMs);
  }

  public query(fromInclusive: SessionTimeMs, toInclusive: SessionTimeMs): readonly TEntry[] {
    this.assertValidTime(fromInclusive);
    this.assertValidTime(toInclusive);
    if (fromInclusive > toInclusive) {
      throw new RangeError("Query start time must not be after end time.");
    }

    const result: TEntry[] = [];
    for (let offset = 0; offset < this.entryCount; offset += 1) {
      const entry = this.entryAt(offset);
      if (entry.time > toInclusive) {
        break;
      }
      if (entry.time >= fromInclusive) {
        result.push(entry);
      }
    }

    return result;
  }

  public clear(): void {
    this.storage = new Array(INITIAL_CAPACITY);
    this.head = 0;
    this.entryCount = 0;
    this.lastAppendedAt = null;
  }

  private assertValidTime(time: SessionTimeMs): void {
    if (!Number.isFinite(time) || time < 0) {
      throw new RangeError("Timeline entry time must be finite and non-negative.");
    }
  }

  private ensureCapacity(): void {
    if (this.entryCount < this.storage.length) {
      return;
    }

    const expanded: Array<TEntry | undefined> = new Array(this.storage.length * 2);
    for (let offset = 0; offset < this.entryCount; offset += 1) {
      expanded[offset] = this.entryAt(offset);
    }

    this.storage = expanded;
    this.head = 0;
  }

  private evictOlderThan(cutoffExclusive: number): void {
    while (this.entryCount > 0) {
      const oldest = this.entryAt(0);
      if (oldest.time >= cutoffExclusive) {
        return;
      }

      this.storage[this.head] = undefined;
      this.head = (this.head + 1) % this.storage.length;
      this.entryCount -= 1;
    }
  }

  private entryAt(offset: number): TEntry {
    const entry = this.storage[(this.head + offset) % this.storage.length];
    if (entry === undefined) {
      throw new Error("RingBuffer storage invariant was violated.");
    }

    return entry;
  }
}
