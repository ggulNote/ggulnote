import type { MathVisualPrimitive } from "@ggulnote/math-core";

export const MATH_GRAPH_CREATE_ANIMATION_DURATION_MS = 1_200;

export interface MathGraphCreateAnimation {
  readonly elapsedMs: number;
  readonly remainingMs: number;
}

export interface MathGraphStrokeAnimation {
  readonly delayMs: number;
  readonly durationMs: number;
}

const graphCreateStartedAt = new Map<string, number>();

/** Rendering-only signal: MathObject and tldraw shape props stay fully final and serializable. */
export function startMathGraphCreateAnimation(
  logicalObjectId: string,
  startedAt = animationClockNow(),
): void {
  graphCreateStartedAt.set(logicalObjectId, startedAt);
}

/** Updates and deletes must never replay an in-progress graph-create animation. */
export function finishMathGraphCreateAnimation(logicalObjectId: string): void {
  graphCreateStartedAt.delete(logicalObjectId);
}

export function readMathGraphCreateAnimation(
  logicalObjectId: string,
  now = animationClockNow(),
): MathGraphCreateAnimation | undefined {
  const startedAt = graphCreateStartedAt.get(logicalObjectId);
  if (startedAt === undefined) return undefined;
  const elapsedMs = Math.max(0, now - startedAt);
  if (elapsedMs >= MATH_GRAPH_CREATE_ANIMATION_DURATION_MS) {
    graphCreateStartedAt.delete(logicalObjectId);
    return undefined;
  }
  return {
    elapsedMs,
    remainingMs: MATH_GRAPH_CREATE_ANIMATION_DURATION_MS - elapsedMs,
  };
}

/**
 * Uses graph VisualPrimitive order directly: x axis, x arrow, y axis, y arrow,
 * then function polylines. Grid, point, tangent, and helper primitives are excluded.
 */
export function createMathGraphStrokeAnimationPlan(
  primitives: readonly MathVisualPrimitive[],
  elapsedMs: number,
): ReadonlyMap<string, MathGraphStrokeAnimation> {
  const strokes = primitives.filter(isGraphCreateStroke);
  const totalWeight = strokes.reduce((sum, primitive) => sum + strokeWeight(primitive), 0);
  const plan = new Map<string, MathGraphStrokeAnimation>();
  let cursor = 0;
  for (const primitive of strokes) {
    const duration = totalWeight === 0
      ? 0
      : MATH_GRAPH_CREATE_ANIMATION_DURATION_MS * strokeWeight(primitive) / totalWeight;
    plan.set(primitive.id, {
      delayMs: cursor - elapsedMs,
      durationMs: duration,
    });
    cursor += duration;
  }
  return plan;
}

function isGraphCreateStroke(primitive: MathVisualPrimitive): boolean {
  if (primitive.kind === "line") return primitive.id.includes(":axis:");
  return primitive.kind === "polyline" && primitive.closed === false;
}

function strokeWeight(primitive: MathVisualPrimitive): number {
  if (primitive.id.includes(":arrowhead")) return 0.35;
  if (primitive.kind === "line") return 1;
  return 2.5;
}

function animationClockNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
