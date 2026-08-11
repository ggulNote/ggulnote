import { EditorEngine } from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import { NativeCanvasRenderer } from "./canvas-2d-renderer";

function createContext() {
  const context = {
    canvas: { width: 600, height: 800, style: {} },
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    setLineDash: vi.fn(),
    strokeRect: vi.fn(),
  };
  return context;
}

describe("NativeCanvasRenderer multi-rect annotations", () => {
  it("renders every underline segment and highlight rect without changing style", () => {
    const context = createContext();
    const renderer = new NativeCanvasRenderer();
    renderer.setCanvas({
      getContext: () => context,
    } as unknown as HTMLCanvasElement);
    const engine = new EditorEngine({
      idGenerator: (() => {
        let id = 0;
        return () => `annotation-${++id}`;
      })(),
    });
    engine.setDocument("doc-1");
    engine.setActivePage("doc-1-page-1", { width: 600, height: 800 });
    const rects = [
      { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
      { x: 0.1, y: 0.24, width: 0.2, height: 0.02 },
    ];
    engine.createAnnotation({
      type: "UNDERLINE",
      pageId: "doc-1-page-1",
      bounds: rects[0],
      rects,
      thickness: 3,
    });
    engine.createAnnotation({
      type: "HIGHLIGHT",
      pageId: "doc-1-page-1",
      bounds: rects[0],
      rects,
      opacity: 0.4,
    });
    engine.select(null);

    engine.render(renderer);

    expect(context.moveTo).toHaveBeenCalledTimes(2);
    expect(context.lineTo).toHaveBeenCalledTimes(2);
    expect(context.fillRect).toHaveBeenCalledTimes(2);
    expect(context.stroke).toHaveBeenCalledTimes(1);
  });
});
