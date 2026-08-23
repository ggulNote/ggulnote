import type { DocumentId } from "@ggulnote/shared-types";
import { openLocalDatabase, type OpenDatabaseOptions } from "../database";
import {
  type PersistedDocumentRecord,
  type PersistedDocumentFileRecord,
  type DocumentRecordViewState,
  type CreateDocumentInput,
  PERSISTENCE_SCHEMA_VERSION,
} from "../types";

const clampPage = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }

  const next = Math.floor(value);
  return Number.isFinite(next) && next > 0 ? next : 1;
};

const clampZoom = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.round(Math.min(200, Math.max(50, value)));
};

const pageIdFor = (documentId: string, page: number): string =>
  `${documentId}-page-${clampPage(page)}`;

export interface CreatePdfDocumentInput {
  document: {
    id: string;
    name: string;
    pageCount: number;
    currentPage?: number;
    zoom?: number;
    zoomMode?: DocumentRecordViewState["zoomMode"];
  };
  file: {
    blob: Blob;
    mimeType: "application/pdf";
    size: number;
    originalName: string;
    lastModified: number | null;
  };
}

export interface CreateBlankDocumentInput {
  document: {
    id: string;
    name: string;
    pageCount: number;
    currentPage?: number;
    zoom?: number;
    zoomMode?: DocumentRecordViewState["zoomMode"];
  };
}

export interface UpdateDocumentViewStateInput {
  currentPage: number;
  zoom: number;
  zoomMode: DocumentRecordViewState["zoomMode"];
}

export class DocumentRepository {
  public constructor(private readonly options: OpenDatabaseOptions = {}) {}

  public async getDocument(documentId: DocumentId): Promise<PersistedDocumentRecord | null> {
    const db = await openLocalDatabase(this.options);
    return (await db.documents.get(documentId)) ?? null;
  }

  public async getDocumentFile(documentId: DocumentId): Promise<PersistedDocumentFileRecord | null> {
    const db = await openLocalDatabase(this.options);
    return (await db.documentFiles.get(documentId)) ?? null;
  }

  public async listDocuments(): Promise<PersistedDocumentRecord[]> {
    const db = await openLocalDatabase(this.options);
    const records = await db.documents.toArray();
    return records.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  }

  public async createPdfDocument(input: CreatePdfDocumentInput): Promise<PersistedDocumentRecord> {
    const now = Date.now();
    const document: PersistedDocumentRecord = {
      id: input.document.id,
      title: input.document.name,
      kind: "pdf",
      name: input.document.name,
      pageCount: input.document.pageCount,
      currentPage: clampPage(input.document.currentPage ?? 1),
      lastActivePageId: pageIdFor(input.document.id, input.document.currentPage ?? 1),
      zoom: clampZoom(input.document.zoom ?? 100),
      zoomMode: input.document.zoomMode ?? "custom",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      nextOperationSequence: 0,
      persistenceSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
    };

    const fileRecord: PersistedDocumentFileRecord = {
      documentId: input.document.id,
      blob: input.file.blob,
      mimeType: input.file.mimeType,
      size: input.file.size,
      originalName: input.file.originalName,
      lastModified: input.file.lastModified,
      createdAt: now,
    };

    const db = await openLocalDatabase(this.options);
    await db.transaction("rw", [db.documents, db.documentFiles], async () => {
      await db.documents.put(document);
      await db.documentFiles.put(fileRecord);
    });

    return document;
  }

  public async createBlankDocument(input: CreateBlankDocumentInput): Promise<PersistedDocumentRecord> {
    const now = Date.now();
    const document: PersistedDocumentRecord = {
      id: input.document.id,
      title: input.document.name,
      kind: "blank",
      name: input.document.name,
      pageCount: input.document.pageCount,
      currentPage: clampPage(input.document.currentPage ?? 1),
      lastActivePageId: pageIdFor(input.document.id, input.document.currentPage ?? 1),
      zoom: clampZoom(input.document.zoom ?? 100),
      zoomMode: input.document.zoomMode ?? "custom",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      nextOperationSequence: 0,
      persistenceSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
    };

    const db = await openLocalDatabase(this.options);
    await db.documents.put(document);
    return document;
  }

  public async updateViewState(documentId: DocumentId, state: UpdateDocumentViewStateInput): Promise<void> {
    const db = await openLocalDatabase(this.options);
    const now = Date.now();

    await db.documents.update(documentId, {
      currentPage: clampPage(state.currentPage),
      lastActivePageId: pageIdFor(documentId, state.currentPage),
      zoom: clampZoom(state.zoom),
      zoomMode: state.zoomMode,
      updatedAt: now,
    });
  }

  public async setNextOperationSequence(documentId: DocumentId, nextOperationSequence: number): Promise<void> {
    const db = await openLocalDatabase(this.options);
    await db.documents.update(documentId, { nextOperationSequence, updatedAt: Date.now() });
  }

  public async markOpened(documentId: DocumentId): Promise<void> {
    const db = await openLocalDatabase(this.options);
    await db.documents.update(documentId, { lastOpenedAt: Date.now(), updatedAt: Date.now() });
  }

  public async deleteDocument(documentId: DocumentId): Promise<void> {
    const db = await openLocalDatabase(this.options);
    await db.documents.delete(documentId);
    await db.documentFiles.delete(documentId);
  }
}

export function toCreateDocumentInput(input: CreateDocumentInput): CreateDocumentInput {
  return {
    ...input,
    kind: input.kind,
  };
}
