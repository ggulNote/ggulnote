import type { DocumentId } from "@ggulnote/shared-types";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import type { EditorOperation } from "../operations/editor-operation";
import { createOperation } from "../operations/editor-operation";
import { deserializeAnnotation } from "../serialization/annotation-serializer";
import type { EditorCommand, EditorCommandContext } from "./editor-command";

export class MoveAnnotationCommand implements EditorCommand {
  private operation: EditorOperation | null = null;

  public constructor(
    private readonly from: SerializedAnnotation,
    private readonly to: SerializedAnnotation,
    private readonly documentId: DocumentId,
  ) {}

  public execute(context: EditorCommandContext): void {
    const scene = context.getPageScene(this.to.pageId);
    const updated = deserializeAnnotation(this.to);
    scene.update(updated);

    this.operation = createOperation({
      documentId: this.documentId,
      pageId: this.to.pageId,
      annotationId: this.to.id,
      type: "MOVE_ANNOTATION",
      payload: {
        from: this.from,
        to: this.to,
      },
    });
  }

  public undo(context: EditorCommandContext): void {
    const scene = context.getPageScene(this.from.pageId);
    const restored = deserializeAnnotation(this.from);
    scene.update(restored);
  }

  public toOperation(): EditorOperation {
    if (!this.operation) {
      throw new Error("Command not executed");
    }

    return this.operation;
  }
}
