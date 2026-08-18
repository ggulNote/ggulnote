import type {
  MathVisualPathCommand,
  MathVisualPrimitive,
} from "@ggulnote/math-core";
import { PathBuilder } from "tldraw";

/** Converts runtime-neutral math primitives into tldraw's public draw-path model. */
export function createMathPrimitivePathBuilder(
  primitive: MathVisualPrimitive,
): PathBuilder | undefined {
  switch (primitive.kind) {
    case "line":
      return new PathBuilder()
        .moveTo(primitive.x1, primitive.y1)
        .lineTo(primitive.x2, primitive.y2);
    case "polyline":
      return polylinePath(primitive.points, primitive.closed);
    case "circle":
      return circlePath(primitive.cx, primitive.cy, primitive.radius);
    case "rect":
      return rectanglePath(
        primitive.x,
        primitive.y,
        primitive.width,
        primitive.height,
      );
    case "path":
      return primitive.commands === undefined
        ? undefined
        : commandPath(primitive.commands);
    case "text":
      return undefined;
  }
}

function polylinePath(
  points: readonly { readonly x: number; readonly y: number }[],
  closed: boolean,
): PathBuilder | undefined {
  const first = points[0];
  if (first === undefined || points.length < 2) return undefined;
  const path = new PathBuilder().moveTo(first.x, first.y);
  for (const point of points.slice(1)) path.lineTo(point.x, point.y);
  return closed ? path.close() : path;
}

function circlePath(
  centerX: number,
  centerY: number,
  radius: number,
): PathBuilder {
  return new PathBuilder()
    .moveTo(centerX + radius, centerY)
    .circularArcTo(radius, false, true, centerX - radius, centerY)
    .circularArcTo(radius, false, true, centerX + radius, centerY)
    .close();
}

function rectanglePath(
  x: number,
  y: number,
  width: number,
  height: number,
): PathBuilder {
  return new PathBuilder()
    .moveTo(x, y)
    .lineTo(x + width, y)
    .lineTo(x + width, y + height)
    .lineTo(x, y + height)
    .close();
}

function commandPath(commands: readonly MathVisualPathCommand[]): PathBuilder | undefined {
  const path = new PathBuilder();
  let started = false;
  for (const command of commands) {
    switch (command.kind) {
      case "move":
        path.moveTo(command.x, command.y);
        started = true;
        break;
      case "line":
        if (!started) return undefined;
        path.lineTo(command.x, command.y);
        break;
      case "arc":
        if (!started) return undefined;
        path.arcTo(
          command.radiusX,
          command.radiusY,
          command.largeArc,
          command.sweep,
          command.xAxisRotationRadians,
          command.x,
          command.y,
        );
        break;
      case "close":
        if (!started) return undefined;
        path.close();
        break;
    }
  }
  return started ? path : undefined;
}
