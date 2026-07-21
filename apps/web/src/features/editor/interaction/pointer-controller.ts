import type { NormalizedPoint } from "@ggulnote/shared-types";
import type { EditorEngine } from "@ggulnote/editor-core";
import type { EditorInteractionMode } from "./interaction-mode";
import { DragSession } from "./drag-session";

type RectangleDraft = {
  start: NormalizedPoint;
  end: NormalizedPoint;
};

export class PointerController {
  private readonly drag = new DragSession();
  private readonly tableDraft = new Map<string, RectangleDraft>();

  public begin(pointer: NormalizedPoint): void {
    this.drag.begin(pointer);
  }

  public update(pointer: NormalizedPoint): void {
    this.drag.move(pointer);
  }

  public end(): { pointer: NormalizedPoint | null } {
    const state = this.drag.end();
    return { pointer: state ? state.last : null };
  }

  public cancel(): void {
    this.drag.cancel();
    this.tableDraft.clear();
  }

  public isDragging(): boolean {
    return this.drag.isActive();
  }

  public createRectangleDraft(mode: EditorInteractionMode, start: NormalizedPoint, end: NormalizedPoint): RectangleDraft {
    const draft = {
      start,
      end,
    };
    this.tableDraft.set(mode, draft);
    return draft;
  }
}
