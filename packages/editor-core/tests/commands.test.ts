import { describe, expect, it } from "vitest";
import { AnnotationFactory } from "../src/annotations/annotation-factory";
import { CreateAnnotationCommand } from "../src/commands/create-annotation-command";
import { DeleteAnnotationCommand } from "../src/commands/delete-annotation-command";
import { MoveAnnotationCommand } from "../src/commands/move-annotation-command";
import { UpdateAnnotationCommand } from "../src/commands/update-annotation-command";
import { CommandManager } from "../src/commands/command-manager";
import { SceneStore } from "../src/scene/scene-store";
import type { EditorCommandContext, EditorCommand } from "../src/commands/editor-command";
import { deserializeAnnotation } from "../src/serialization/annotation-serializer";

const baseContext = (sceneStore: SceneStore): EditorCommandContext => ({
  getSceneStore: () => sceneStore,
  getActivePageId: () => "page-1",
  selectAnnotation: () => undefined,
  getSelectedAnnotationId: () => null,
  getPageScene: (pageId) => sceneStore.getOrCreatePage(pageId),
  notifyChange: () => undefined,
});

const createFactory = () => {
  let id = 0;
  return new AnnotationFactory({
    idGenerator: () => `ann-${++id}`,
    now: () => 1_000,
  });
};

describe("CommandManager and commands", () => {
  it("executes, undoes and redoes create command", () => {
    const sceneStore = new SceneStore();
    const context = baseContext(sceneStore);
    const commandManager = new CommandManager(() => context, { historyLimit: 3 });
    const factory = createFactory();

    const annotation = factory.create({
      type: "TEXT",
      pageId: "page-1",
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      text: "memo",
    });

    const create = new CreateAnnotationCommand(annotation, "doc-1");
    commandManager.execute(create);

    expect(sceneStore.getPage("page-1")?.get(annotation.id)).toBeTruthy();
    expect(commandManager.canUndo()).toBe(true);
    expect(commandManager.canRedo()).toBe(false);

    const undo = commandManager.undo();
    expect(undo).toBe(create);
    expect(sceneStore.getPage("page-1")?.get(annotation.id)).toBeNull();

    const redo = commandManager.redo();
    expect(redo).toBe(create);
    expect(sceneStore.getPage("page-1")?.get(annotation.id)).toBeTruthy();
  });

  it("deletes and restores annotation with snapshot", () => {
    const sceneStore = new SceneStore();
    const context = baseContext(sceneStore);
    const commandManager = new CommandManager(() => context, { historyLimit: 3 });
    const factory = createFactory();

    const annotation = factory.create({
      type: "HIGHLIGHT",
      pageId: "page-1",
      bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
    });

    const scene = sceneStore.getOrCreatePage("page-1");
    scene.add(annotation);

    const del = new DeleteAnnotationCommand(annotation.serialize(), "doc-1");
    commandManager.execute(del);
    expect(scene.get(annotation.id)).toBeNull();

    const undo = commandManager.undo();
    expect(undo).toBe(del);
    expect(scene.get(annotation.id)).not.toBeNull();
  });

  it("moves and updates via serialized snapshots", () => {
    const sceneStore = new SceneStore();
    const context = baseContext(sceneStore);
    const commandManager = new CommandManager(() => context, { historyLimit: 3 });
    const scene = sceneStore.getOrCreatePage("page-1");

    const from = {
      schemaVersion: 1,
      id: "ann-1",
      pageId: "page-1",
      type: "TEXT",
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.08 },
      zIndex: 1,
      properties: { text: "memo", fontSize: 14, textAlign: "left" },
      createdAt: 1,
      updatedAt: 1,
    };

    const moved = deserializeAnnotation(from);
    moved.translate({ x: 0.2, y: 0.2 });
    const to = moved.serialize();

    scene.add(deserializeAnnotation(from));

    const move = new MoveAnnotationCommand(from, to, "doc-1");
    commandManager.execute(move);
    expect(scene.get("ann-1")?.bounds).toEqual(to.bounds);

    const undo = commandManager.undo();
    expect(undo).toBe(move);
    expect(scene.get("ann-1")?.bounds).toEqual(from.bounds);
  });

  it("stores update command payloads", () => {
    const context = baseContext(new SceneStore());
    const commandManager = new CommandManager(() => context, { historyLimit: 3 });
    const scene = context.getSceneStore().getOrCreatePage("page-1");

    const original = {
      schemaVersion: 1,
      id: "ann-1",
      pageId: "page-1",
      type: "TABLE",
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      zIndex: 1,
      properties: { rows: 2, columns: 2 },
      createdAt: 1,
      updatedAt: 1,
    };

    scene.add(deserializeAnnotation(original));

    const updated = {
      ...original,
      properties: { ...original.properties, rows: 3, columns: 3 },
    };

    const command = new UpdateAnnotationCommand(original, updated, "doc-1");
    commandManager.execute(command);
    const annotation = scene.get("ann-1");

    expect(annotation).not.toBeNull();
    if (annotation && annotation.type === "TABLE") {
      expect(annotation.rows).toBe(3);
      expect(annotation.columns).toBe(3);
    }

    commandManager.undo();
    const reverted = scene.get("ann-1");
    expect(reverted).not.toBeNull();
    if (reverted && reverted.type === "TABLE") {
      expect(reverted.rows).toBe(2);
      expect(reverted.columns).toBe(2);
    }
  });

  it("keeps history limit and keeps last operations", () => {
    const sceneStore = new SceneStore();
    const context = baseContext(sceneStore);
    const commandManager = new CommandManager(() => context, { historyLimit: 2 });
    const factory = createFactory();

    const annotations = [
      factory.create({ type: "TEXT", pageId: "page-1", bounds: { x: 0, y: 0, width: 0.1, height: 0.1 }, text: "a" }),
      factory.create({ type: "TEXT", pageId: "page-1", bounds: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, text: "b" }),
      factory.create({ type: "TEXT", pageId: "page-1", bounds: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }, text: "c" }),
    ];

    annotations.forEach((annotation) => {
      commandManager.execute(new CreateAnnotationCommand(annotation, "doc-1"));
    });

    expect(commandManager.getUndoStackSize()).toBe(2);

    const firstUndo = commandManager.undo();
    expect(firstUndo).toBeDefined();
    expect(commandManager.getUndoStackSize()).toBe(1);
    expect(commandManager.getRedoStackSize()).toBe(1);
  });

  it("does not push command on failed execute", () => {
    const commandManager = new CommandManager(() => baseContext(new SceneStore()), { historyLimit: 2 });

    const failCommand: EditorCommand = {
      execute: () => {
        throw new Error("fail");
      },
      undo: () => undefined,
      toOperation: () => {
        throw new Error("fail");
      },
    };

    expect(() => commandManager.execute(failCommand)).toThrow("fail");
    expect(commandManager.canUndo()).toBe(false);
    expect(commandManager.getUndoStackSize()).toBe(0);
  });
});
