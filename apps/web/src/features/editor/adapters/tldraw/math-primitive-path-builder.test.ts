import { describe, expect, it } from "vitest";
import {
  createMathShape,
  createMathVisualModel,
  type MathVisualPrimitive,
} from "@ggulnote/math-core";
import { createMathPrimitivePathBuilder } from "./math-primitive-path-builder";

describe("tldraw math primitive PathBuilder", () => {
  it("creates deterministic tldraw draw paths from graph-style lines and polylines", () => {
    const line: MathVisualPrimitive = {
      kind: "line",
      id: "graph:axis:x",
      x1: 10,
      y1: 20,
      x2: 210,
      y2: 20,
      stroke: "#172033",
      strokeWidth: 2,
      opacity: 1,
    };
    const polyline: MathVisualPrimitive = {
      kind: "polyline",
      id: "graph:function:1",
      points: [{ x: 10, y: 90 }, { x: 80, y: 40 }, { x: 160, y: 70 }],
      closed: false,
      fill: "none",
      stroke: "#2563eb",
      strokeWidth: 2,
      opacity: 1,
    };
    const linePath = createMathPrimitivePathBuilder(line);
    const curvePath = createMathPrimitivePathBuilder(polyline);
    if (linePath === undefined || curvePath === undefined) {
      throw new Error("Expected PathBuilder output.");
    }
    const options = { strokeWidth: 2, randomSeed: "stable-line", passes: 2 } as const;
    expect(createMathPrimitivePathBuilder(line)?.toDrawD(options))
      .toBe(createMathPrimitivePathBuilder(line)?.toDrawD(options));
    expect(linePath.toDrawD(options)).not.toBe(linePath.toD());
    const curveOptions = {
      ...options,
      randomSeed: `logical-graph:${polyline.id}`,
    } as const;
    expect(createMathPrimitivePathBuilder(polyline)?.toDrawD(curveOptions))
      .toBe(createMathPrimitivePathBuilder(polyline)?.toDrawD(curveOptions));
    expect(curvePath.toDrawD(curveOptions)).not.toBe(curvePath.toD());
  });

  it("supports closed rectangles and circles without changing the source primitive", () => {
    const rectangle: MathVisualPrimitive = {
      kind: "rect",
      id: "table:header",
      x: 10,
      y: 10,
      width: 120,
      height: 40,
      fill: "#f8fafc",
      stroke: "#172033",
      strokeWidth: 1.5,
      opacity: 1,
    };
    const circle: MathVisualPrimitive = {
      kind: "circle",
      id: "shape:circle",
      cx: 80,
      cy: 80,
      radius: 45,
      fill: "none",
      stroke: "#172033",
      strokeWidth: 2,
      opacity: 1,
    };
    expect(createMathPrimitivePathBuilder(rectangle)?.toD()).toContain("Z");
    expect(createMathPrimitivePathBuilder(circle)?.toD()).toContain("C");
    expect(rectangle).toMatchObject({ kind: "rect", x: 10, width: 120 });
  });

  it("uses neutral arc commands for arc and sector math primitives", () => {
    const sector = createMathShape({
      bounds: { x: 0, y: 0, width: 200, height: 160 },
      style: { handDrawn: true },
      shapeType: "sector",
      geometry: {
        kind: "arc",
        center: { x: 80, y: 80 },
        radius: 50,
        startAngleDegrees: 0,
        endAngleDegrees: 120,
      },
    }, "sector-path");
    const primitive = createMathVisualModel(sector).primitives.find((entry) =>
      entry.kind === "path");
    if (primitive === undefined || primitive.kind !== "path") {
      throw new Error("Expected sector path primitive.");
    }
    expect(primitive.commands?.map((command) => command.kind)).toEqual([
      "move",
      "arc",
      "line",
      "close",
    ]);
    const path = createMathPrimitivePathBuilder(primitive);
    expect(path?.toDrawD({
      strokeWidth: primitive.strokeWidth,
      randomSeed: primitive.id,
      passes: 2,
    })).toContain("C");
  });

  it("leaves text rendering to the existing SVG text adapter", () => {
    const text: MathVisualPrimitive = {
      kind: "text",
      id: "label",
      x: 10,
      y: 20,
      text: "A",
      color: "#172033",
      fontSize: 16,
      fontFamily: "Arial, sans-serif",
      fontWeight: "normal",
      anchor: "start",
      opacity: 1,
    };
    expect(createMathPrimitivePathBuilder(text)).toBeUndefined();
  });
});
