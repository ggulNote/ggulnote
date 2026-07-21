import type { DocumentId } from "@ggulnote/shared-types";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";
import type { EditorOperation } from "../operations/editor-operation";
import { createOperation } from "../operations/editor-operation";
import { deserializeAnnotation } from "../serialization/annotation-serializer";
import type { EditorCommand, EditorCommandContext } from "./editor-command";

export class DeleteAnnotationCommand implements EditorCommand {
  private operation: EditorOperation | null = null;

  public constructor(
    private readonly snapshot: SerializedAnnotation,
    private readonly documentId: DocumentId,
  ) {}

  public execute(context: EditorCommandContext): void {
    const scene = context.getPageScene(this.snapshot.pageId);
    const removed = scene.remove(this.snapshot.id);
    if (!removed) {
      throw new Error("Annotation not found");
    }

    if (context.getSelectedAnnotationId() === this.snapshot.id) {
      context.selectAnnotation(null);
    }

    this.operation = createOperation({
      documentId: this.documentId,
      pageId: this.snapshot.pageId,
      annotationId: this.snapshot.id,
      type: "DELETE_ANNOTATION",
      payload: { annotation: this.snapshot },
    });
  }

  public undo(context: EditorCommandContext): void {
    const scene = context.getPageScene(this.snapshot.pageId);
    const annotation = deserializeAnnotation(this.snapshot);
    scene.add(annotation);
  }

  public toOperation(): EditorOperation {
    if (!this.operation) {
      throw new Error("Command not executed");
    }

    return this.operation;
  }
}
