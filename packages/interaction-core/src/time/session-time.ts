import type { SessionTimeMs } from "@ggulnote/shared-types";

export type { SessionTimeMs } from "@ggulnote/shared-types";

/**
 * Validates and brands a session-relative timestamp.
 */
export const toSessionTimeMs = (value: number): SessionTimeMs => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("SessionTimeMs must be a finite, non-negative number.");
  }

  return value as SessionTimeMs;
};
