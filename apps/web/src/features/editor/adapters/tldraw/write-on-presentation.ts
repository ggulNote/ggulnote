export const HANDWRITING_FONT_STACK = [
  "'Ggulnote Handwriting'",
  "'Nanum Pen Script'",
  "'Segoe Print'",
  "'Comic Sans MS'",
  "'STIX Two Math'",
  "'Cambria Math'",
  "cursive",
].join(", ");

export const WRITE_ON_DURATION_POLICY = Object.freeze({
  baseMs: 240,
  perGlyphMs: 34,
  minimumMs: 360,
  maximumMs: 1_000,
});

export interface WriteOnAnimation {
  readonly durationMs: number;
  readonly elapsedMs: number;
  readonly remainingMs: number;
}

interface WriteOnStart {
  readonly startedAt: number;
  readonly durationMs: number;
}

const activeWriteOn = new Map<string, WriteOnStart>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function computeWriteOnDuration(content: string): number {
  const glyphCount = Math.max(1, Array.from(content.normalize("NFC")).length);
  const duration = WRITE_ON_DURATION_POLICY.baseMs
    + glyphCount * WRITE_ON_DURATION_POLICY.perGlyphMs;
  return Math.min(
    WRITE_ON_DURATION_POLICY.maximumMs,
    Math.max(WRITE_ON_DURATION_POLICY.minimumMs, duration),
  );
}

/** Ephemeral renderer signal. It is never written to TLStore or the domain object. */
export function startWriteOn(
  objectKey: string,
  content: string,
  startedAt = animationClockNow(),
): void {
  finishWriteOn(objectKey);
  const active = {
    startedAt,
    durationMs: computeWriteOnDuration(content),
  };
  activeWriteOn.set(objectKey, active);
  const timer = setTimeout(() => {
    if (activeWriteOn.get(objectKey) === active) activeWriteOn.delete(objectKey);
    cleanupTimers.delete(objectKey);
  }, active.durationMs);
  cleanupTimers.set(objectKey, timer);
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function finishWriteOn(objectKey: string): void {
  activeWriteOn.delete(objectKey);
  const timer = cleanupTimers.get(objectKey);
  if (timer !== undefined) clearTimeout(timer);
  cleanupTimers.delete(objectKey);
}

export function readWriteOn(
  objectKey: string,
  now = animationClockNow(),
): WriteOnAnimation | undefined {
  const active = activeWriteOn.get(objectKey);
  if (active === undefined) return undefined;
  const elapsedMs = Math.max(0, now - active.startedAt);
  if (elapsedMs >= active.durationMs) {
    finishWriteOn(objectKey);
    return undefined;
  }
  return {
    durationMs: active.durationMs,
    elapsedMs,
    remainingMs: active.durationMs - elapsedMs,
  };
}

function animationClockNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
