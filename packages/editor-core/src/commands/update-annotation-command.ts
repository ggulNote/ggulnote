import type { DocumentId } from "@ggulnote/shared-types";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import type { EditorOperation } from "../operations/editor-operation";
import { createOperation } from "../operations/editor-operation";
import { deserializeAnnotation } from "../serialization/annotation-serializer";
import type { EditorCommand, EditorCommandContext } from "./editor-command";

export class UpdateAnnotationCommand implements EditorCommand {
  private operation: EditorOperation | null = null;

  public constructor(
    private readonly before: SerializedAnnotation,
    private readonly after: SerializedAnnotation,
    private readonly documentId: DocumentId,
  ) {}

  public execute(context: EditorCommandContext): void {
    const scene = context.getPageScene(this.after.pageId);
    scene.update(deserializeAnnotation(this.after));

    this.operation = createOperation({
      documentId: this.documentId,
      pageId: this.after.pageId,
      annotationId: this.after.id,
      type: "UPDATE_ANNOTATION",
      payload: {
        before: this.before,
        after: this.after,
      },
    });
  }

  public undo(context: EditorCommandContext): void {
    const scene = context.getPageScene(this.before.pageId);
    scene.update(deserializeAnnotation(this.before));
  }

  public toOperation(): EditorOperation {
    if (!this.operation) {
      throw new Error("Command not executed");
    }

    return this.operation;
  }
}
