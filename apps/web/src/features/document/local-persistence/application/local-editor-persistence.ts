import type { DocumentId, PageId } from "@ggulnote/shared-types";
import type { EditorPersistenceEvent, PageSceneSnapshot } from "@ggulnote/editor-core";
import { AppStateRepository } from "../repositories/app-state-repository";
import { DocumentRepository, type CreateBlankDocumentInput, type CreatePdfDocumentInput } from "../repositories/document-repository";
import { OperationRepository } from "../repositories/operation-repository";
import { PageSnapshotRepository } from "../repositories/page-snapshot-repository";
import { SemanticPageRepository, type SemanticPageQueryOptions, type SaveSemanticPageInput } from "../repositories/semantic-page-repository";
import { ANNOTATION_SCHEMA_VERSION, PDF_ANALYSIS_VERSION, TLDRAW_CANVAS_STORE_VERSION, type CreateDocumentInput, type PersistedAppStateRecord, type PersistedDocumentRecord, type PersistedDocumentFileRecord, type PersistedOperationRecord, type PersistedPageSnapshotRecord, type PersistedSemanticPageRecord, type DocumentRecordViewState, type NoteSession } from "../types";
import { openLocalDatabase, type OpenDatabaseOptions } from "../database";
import { IndexedDbEmbeddingStore } from "../repositories/indexed-db-embedding-store";

const createPageSnapshotId = (documentId: DocumentId, pageId: PageId): string =>
  `${documentId}:${pageId}`;

const createOperationId = (documentId: DocumentId, sequence: number): string =>
  `${documentId}:${sequence}`;


const clampPage = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }

  const page = Math.floor(value);
  return page > 0 ? page : 1;
};

const clampZoom = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.round(Math.min(200, Math.max(50, value)));
};

export interface LastOpenedDocumentState {
  document: PersistedDocumentRecord;
  file: PersistedDocumentFileRecord | null;
}

export interface OpenedNoteSession {
  session: NoteSession;
  file: PersistedDocumentFileRecord | null;
}

export interface SaveEditorOperationInput {
  event: EditorPersistenceEvent;
  snapshot: PageSceneSnapshot;
  documentViewState: DocumentRecordViewState;
}

export interface GetSemanticPageInput extends SemanticPageQueryOptions {
  extractorVersion?: string;
  semanticSchemaVersion?: number;
}

export interface SaveTldrawPageSnapshotInput {
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  snapshot: unknown;
  annotations: PageSceneSnapshot["annotations"];
}

export class LocalEditorPersistence {
  private readonly documentRepository: DocumentRepository;
  private readonly snapshotRepository: PageSnapshotRepository;
  private readonly operationRepository: OperationRepository;
  private readonly appStateRepository: AppStateRepository;
  private readonly semanticPageRepository: SemanticPageRepository;
  private readonly embeddingStore: IndexedDbEmbeddingStore;

  public constructor(private readonly options: OpenDatabaseOptions = {}) {
    this.documentRepository = new DocumentRepository(options);
    this.snapshotRepository = new PageSnapshotRepository(options);
    this.operationRepository = new OperationRepository(options);
    this.appStateRepository = new AppStateRepository(options);
    this.semanticPageRepository = new SemanticPageRepository(options);
    this.embeddingStore = new IndexedDbEmbeddingStore(options);
  }

  public async getEditorState(): Promise<PersistedAppStateRecord> {
    return this.appStateRepository.getEditorState();
  }

  public async markOpened(documentId: DocumentId): Promise<void> {
    await this.documentRepository.markOpened(documentId);
    await this.appStateRepository.setLastOpenedDocument(documentId);
  }

  public async markPersistentStorageRequested(): Promise<void> {
    await this.appStateRepository.markPersistentStorageRequested();
  }

  public async getLastOpenedDocument(): Promise<LastOpenedDocumentState | null> {
    const appState = await this.appStateRepository.getEditorState();
    if (!appState.lastOpenedDocumentId) {
      return null;
    }

    const document = await this.documentRepository.getDocument(appState.lastOpenedDocumentId);
    if (!document) {
      await this.appStateRepository.setLastOpenedDocument(null);
      return null;
    }

    const file = await this.documentRepository.getDocumentFile(appState.lastOpenedDocumentId);
    if (document.kind === "pdf" && !file) {
      return null;
    }

    return {
      document,
      file,
    };
  }

  public async getSession(sessionId: DocumentId): Promise<OpenedNoteSession | null> {
    const document = await this.documentRepository.getDocument(sessionId);
    if (!document) return null;
    const file = await this.documentRepository.getDocumentFile(sessionId);
    if (document.kind === 'pdf' && !file) return null;
    return {
      session: toNoteSession(document, file),
      file,
    };
  }

  public async getLastOpenedSession(): Promise<OpenedNoteSession | null> {
    const saved = await this.getLastOpenedDocument();
    const opened = saved === null
      ? null
      : {
          session: toNoteSession(saved.document, saved.file),
          file: saved.file,
        };
    if (opened !== null) traceNoteSession('opened', opened.session);
    return opened;
  }

  public async listSessions(): Promise<NoteSession[]> {
    const documents = await this.documentRepository.listDocuments();
    const sessions = await Promise.all(documents.map(async (document) => {
      const file = document.kind === 'pdf'
        ? await this.documentRepository.getDocumentFile(document.id)
        : null;
      return document.kind === 'pdf' && file === null
        ? null
        : toNoteSession(document, file);
    }));
    return sessions.filter((session): session is NoteSession => session !== null);
  }

  public async openSession(sessionId: DocumentId): Promise<OpenedNoteSession | null> {
    const saved = await this.getSession(sessionId);
    if (saved === null) return null;
    await this.markOpened(sessionId);
    const opened = await this.getSession(sessionId);
    if (opened !== null) {
      traceNoteSession('opened', opened.session);
    }
    return opened;
  }

  public async findPdfSessionByOriginalFileName(
    requestedFileName: string,
  ): Promise<OpenedNoteSession | null> {
    const normalized = requestedFileName.normalize('NFC').trim().toLocaleLowerCase();
    if (normalized.length === 0) return null;
    const sessions = await this.listSessions();
    const match = sessions.find((session) =>
      session.source.kind === 'pdf'
      && (
        session.title.normalize('NFC').trim().toLocaleLowerCase() === normalized
        || session.source.originalFileName.normalize('NFC').trim().toLocaleLowerCase() === normalized
      ));
    return match === undefined ? null : this.openSession(match.id);
  }

  public async listDocuments() {
    return this.documentRepository.listDocuments();
  }

  public async getDocument(documentId: DocumentId): Promise<PersistedDocumentRecord | null> {
    return this.documentRepository.getDocument(documentId);
  }

  public async getDocumentFile(documentId: DocumentId): Promise<PersistedDocumentFileRecord | null> {
    return this.documentRepository.getDocumentFile(documentId);
  }

  public async createPdfDocument(input: CreatePdfDocumentInput): Promise<PersistedDocumentRecord> {
    const created = await this.documentRepository.createPdfDocument(input);
    await this.markOpened(created.id);
    return created;
  }

  public async createBlankDocument(input: CreateBlankDocumentInput): Promise<PersistedDocumentRecord> {
    const created = await this.documentRepository.createBlankDocument(input);
    await this.markOpened(created.id);
    return created;
  }

  public async createPdfSession(input: CreatePdfDocumentInput): Promise<NoteSession> {
    const document = await this.createPdfDocument(input);
    const file = await this.documentRepository.getDocumentFile(document.id);
    const session = toNoteSession(document, file);
    traceNoteSession('created', session);
    return session;
  }

  public async createBlankSession(input: CreateBlankDocumentInput): Promise<NoteSession> {
    const document = await this.createBlankDocument(input);
    const session = toNoteSession(document, null);
    traceNoteSession('created', session);
    return session;
  }

  public async createDocumentFromState(input: CreateDocumentInput): Promise<PersistedDocumentRecord> {
    if (input.kind === "pdf") {
      throw new Error("Use createPdfDocument for PDF documents");
    }

    return this.createBlankDocument({ document: input });
  }

  public async getPageSnapshot(
    documentId: DocumentId,
    pageId: PageId,
  ): Promise<PersistedPageSnapshotRecord | null> {
    return this.snapshotRepository.getPageSnapshot(documentId, pageId);
  }

  /**
   * Persists the TLStore in the existing pageSnapshots record. The annotations
   * projection is compatibility data only; once loaded, TLStore owns canvas state.
   */
  public async saveTldrawPageSnapshot(
    input: SaveTldrawPageSnapshotInput,
  ): Promise<PersistedPageSnapshotRecord> {
    const db = await openLocalDatabase(this.options);
    const id = createPageSnapshotId(input.documentId, input.pageId);
    const existing = await db.pageSnapshots.get(id);
    if (
      existing?.tldrawCanvasStoreVersion === TLDRAW_CANVAS_STORE_VERSION
      && areTldrawSnapshotsEqual(existing.tldrawSnapshot, input.snapshot)
    ) {
      return existing;
    }
    const now = Date.now();
    const record: PersistedPageSnapshotRecord = {
      id,
      documentId: input.documentId,
      pageId: input.pageId,
      pageNumber: input.pageNumber,
      revision: (existing?.revision ?? 0) + 1,
      contextRevision: (existing?.contextRevision ?? existing?.revision ?? 0) + 1,
      annotations: input.annotations,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      annotationSchemaVersion: ANNOTATION_SCHEMA_VERSION,
      tldrawCanvasStoreVersion: TLDRAW_CANVAS_STORE_VERSION,
      tldrawSnapshot: input.snapshot,
    };
    await db.pageSnapshots.put(record);
    return record;
  }

  public async listDocumentSnapshots(documentId: DocumentId): Promise<PersistedPageSnapshotRecord[]> {
    return this.snapshotRepository.listDocumentSnapshots(documentId);
  }

  public async getSemanticPage(
    documentId: DocumentId,
    pageId: PageId,
    options: GetSemanticPageInput = {},
  ): Promise<PersistedSemanticPageRecord | null> {
    return this.semanticPageRepository.getByPage(documentId, pageId, options);
  }

  public async getPdfAnalysis(
    documentId: DocumentId,
    pageId: PageId,
  ): Promise<PersistedSemanticPageRecord | null> {
    return this.semanticPageRepository.getByPage(documentId, pageId, {
      analysisVersion: PDF_ANALYSIS_VERSION,
    });
  }

  public async saveSemanticPage(input: SaveSemanticPageInput): Promise<PersistedSemanticPageRecord> {
    return this.semanticPageRepository.save(input);
  }

  public async deleteSemanticPages(documentId: DocumentId): Promise<void> {
    await this.semanticPageRepository.deleteByDocumentId(documentId);
  }

  public async updateViewState(
    documentId: DocumentId,
    state: DocumentRecordViewState,
  ): Promise<void> {
    await this.documentRepository.updateViewState(documentId, {
      currentPage: clampPage(state.currentPage),
      zoom: clampZoom(state.zoom),
      zoomMode: state.zoomMode,
    });
  }

  public async saveSession(
    sessionId: DocumentId,
    state: DocumentRecordViewState,
  ): Promise<NoteSession | null> {
    await this.updateViewState(sessionId, state);
    const saved = await this.getSession(sessionId);
    if (saved !== null) {
      traceNoteSession('persisted', saved.session);
    }
    return saved?.session ?? null;
  }

  public async saveOperation(input: SaveEditorOperationInput): Promise<PersistedOperationRecord> {
    const db = await openLocalDatabase(this.options);
    const document = await this.documentRepository.getDocument(input.event.documentId);
    if (!document) {
      throw new Error("Document not found");
    }

    const operationSequence = document.nextOperationSequence + 1;
    const now = Date.now();

    const snapshot: PersistedPageSnapshotRecord = {
      id: createPageSnapshotId(input.event.documentId, input.event.pageId),
      documentId: input.event.documentId,
      pageId: input.event.pageId,
      pageNumber: input.event.pageNumber,
      revision: input.event.revision,
      contextRevision: input.event.revision,
      annotations: input.snapshot.annotations,
      createdAt: now,
      updatedAt: now,
      annotationSchemaVersion: ANNOTATION_SCHEMA_VERSION,
    };

    let createdOperation: PersistedOperationRecord;

    await db.transaction("rw", [db.documents, db.operations, db.pageSnapshots, db.appState, db.semanticPages, db.embeddings], async () => {
      await this.snapshotRepository.savePageSnapshot(snapshot);
      createdOperation = await this.operationRepository.appendOperation({
        documentId: input.event.documentId,
        pageId: input.event.pageId,
        annotationId: input.event.operation.annotationId,
        sequence: operationSequence,
        historyAction: input.event.historyAction,
        operation: input.event.operation,
      });
      await this.documentRepository.setNextOperationSequence(input.event.documentId, operationSequence);
      await this.updateViewState(input.event.documentId, {
        ...input.documentViewState,
        currentPage: clampPage(input.documentViewState.currentPage),
        zoom: clampZoom(input.documentViewState.zoom),
      });
      await this.appStateRepository.setLastOpenedDocument(input.event.documentId);
    });

    return createdOperation!;
  }

  public async deleteDocument(documentId: DocumentId): Promise<void> {
    const db = await openLocalDatabase(this.options);
    await db.transaction("rw", [db.documents, db.documentFiles, db.pageSnapshots, db.operations, db.appState, db.semanticPages, db.embeddings], async () => {
      await this.documentRepository.deleteDocument(documentId);
      await this.snapshotRepository.deleteByDocumentId(documentId);
      await this.operationRepository.deleteByDocumentId(documentId);
      await this.semanticPageRepository.deleteByDocumentId(documentId);
      await this.embeddingStore.deleteByDocument(documentId);

      const editorState = await this.appStateRepository.getEditorState();
      if (editorState.lastOpenedDocumentId === documentId) {
        await this.appStateRepository.setLastOpenedDocument(null);
      }
    });
  }
}

export function areTldrawSnapshotsEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function toNoteSession(
  document: PersistedDocumentRecord,
  file: PersistedDocumentFileRecord | null,
): NoteSession {
  const title = document.title.trim().length > 0 ? document.title : document.name;
  return {
    id: document.id,
    kind: document.kind,
    title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    lastOpenedAt: document.lastOpenedAt,
    lastActivePageId: document.lastActivePageId,
    pageCount: document.pageCount,
    currentPage: document.currentPage,
    zoom: document.zoom,
    zoomMode: document.zoomMode,
    source: document.kind === 'pdf'
      ? {
          kind: 'pdf',
          originalFileName: file?.originalName ?? document.name,
          blobKey: document.id,
        }
      : {
          kind: 'blank',
        },
  };
}

function traceNoteSession(event: string, session: NoteSession): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.info('[NOTE_SESSION_TRACE]', {
    event,
    sessionId: session.id,
    kind: session.kind,
    pageId: session.lastActivePageId,
  });
}
