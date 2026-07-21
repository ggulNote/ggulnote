import type { NormalizedPoint } from "@ggulnote/shared-types";

type DragSessionState = {
  start: NormalizedPoint;
  last: NormalizedPoint;
  isDragging: boolean;
};

export class DragSession {
  private state: DragSessionState | null = null;

  public begin(pointer: NormalizedPoint): void {
    this.state = {
      start: { ...pointer },
      last: { ...pointer },
      isDragging: false,
    };
  }

  public move(pointer: NormalizedPoint): void {
    if (!this.state) {
      return;
    }

    this.state.last = { ...pointer };
    this.state.isDragging = true;
  }

  public end(): DragSessionState | null {
    const current = this.state;
    this.state = null;
    return current;
  }

  public cancel(): void {
    this.state = null;
  }

  public getSnapshot(): DragSessionState | null {
    return this.state ? { ...this.state } : null;
  }

  public isActive(): boolean {
    return this.state != null;
  }
}
