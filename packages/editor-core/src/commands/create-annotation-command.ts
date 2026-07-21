import type { DocumentId, AnnotationId, PageId } from "@ggulnote/shared-types";
import type { EditorOperation } from "../operations/editor-operation";
import { createOperation } from "../operations/editor-operation";
import type { EditorCommand, EditorCommandContext } from "./editor-command";
import type { Annotation } from "../annotations/annotation";

export class CreateAnnotationCommand implements EditorCommand {
  private operation: EditorOperation | null = null;

  public constructor(
    private readonly annotation: Annotation,
    private readonly documentId: DocumentId,
  ) {}

  public execute(context: EditorCommandContext): void {
    const scene = context.getPageScene(this.annotation.pageId);
    scene.add(this.annotation);
    context.selectAnnotation(this.annotation.id);

    this.operation = createOperation({
      documentId: this.documentId,
      pageId: this.annotation.pageId,
      annotationId: this.annotation.id,
      type: "CREATE_ANNOTATION",
      payload: { annotation: this.annotation.serialize() },
    });
  }

  public undo(context: EditorCommandContext): void {
    const scene = context.getPageScene(this.annotation.pageId);
    scene.remove(this.annotation.id);
    if (context.getSelectedAnnotationId() === this.annotation.id) {
      context.selectAnnotation(null);
    }
  }

  public toOperation(): EditorOperation {
    if (!this.operation) {
      throw new Error("Command not executed");
    }

    return this.operation;
  }
}
