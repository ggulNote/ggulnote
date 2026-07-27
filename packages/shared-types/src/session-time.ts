declare const sessionTimeMsBrand: unique symbol;

/**
 * Milliseconds elapsed since the start of one interaction session.
 *
 * The brand prevents an absolute timestamp or an unrelated number from being
 * passed to APIs that operate on the shared interaction timeline.
 */
export type SessionTimeMs = number & {
  readonly [sessionTimeMsBrand]: "SessionTimeMs";
};
