import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { buildPageSemanticModel } from '@ggulnote/document-core';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalEditorPersistence } from './application/local-editor-persistence';
import { openLocalDatabase } from './database';
import { getPersistedPageContextRevision, PDF_ANALYSIS_VERSION } from './types';

const databaseNames = new Set<string>();

afterEach(async () => {
  for (const name of databaseNames) {
    const database = await openLocalDatabase({ databaseName: name });
    database.close();
    await Dexie.delete(name);
  }
  databaseNames.clear();
});

describe('note session persistence', () => {
  it('restores blank TLStore objects after switching sessions without a false revision', async () => {
    const persistence = createPersistence();
    await persistence.createBlankSession({ document: blankDocument('blank-a', '빈 캔버스') });
    const snapshot = { document: { store: { 'shape:note-1': { id: 'shape:note-1', typeName: 'shape' } } } };
    const firstSave = await persistence.saveTldrawPageSnapshot({
      documentId: 'blank-a',
      pageId: 'blank-a-page-1',
      pageNumber: 1,
      snapshot,
      annotations: [],
    });
    await persistence.createBlankSession({ document: blankDocument('blank-b', '빈 캔버스 2') });

    const reopened = await persistence.openSession('blank-a');
    const restored = await persistence.getPageSnapshot('blank-a', 'blank-a-page-1');
    const unchangedSave = await persistence.saveTldrawPageSnapshot({
      documentId: 'blank-a',
      pageId: 'blank-a-page-1',
      pageNumber: 1,
      snapshot,
      annotations: [],
    });
    const changedSave = await persistence.saveTldrawPageSnapshot({
      documentId: 'blank-a',
      pageId: 'blank-a-page-1',
      pageNumber: 1,
      snapshot: {
        document: {
          store: {
            'shape:note-1': { id: 'shape:note-1', typeName: 'shape' },
            'shape:note-2': { id: 'shape:note-2', typeName: 'shape' },
          },
        },
      },
      annotations: [],
    });

    expect(reopened?.session.title).toBe('빈 캔버스');
    expect(restored?.tldrawSnapshot).toEqual(snapshot);
    expect(firstSave.revision).toBe(1);
    expect(getPersistedPageContextRevision(firstSave)).toBe(1);
    expect(unchangedSave.revision).toBe(1);
    expect(getPersistedPageContextRevision(unchangedSave)).toBe(1);
    expect(changedSave.revision).toBe(2);
    expect(getPersistedPageContextRevision(changedSave)).toBe(2);
  });

  it('falls back to legacy page revision for contextRevision', () => {
    expect(getPersistedPageContextRevision({ revision: 8 })).toBe(8);
    expect(getPersistedPageContextRevision({ revision: 8, contextRevision: 3 })).toBe(3);
    expect(getPersistedPageContextRevision(null)).toBe(0);
  });

  it('restores the PDF source, last page, and versioned semantic analysis', async () => {
    const persistence = createPersistence();
    const file = new Blob(['pdf-bytes'], { type: 'application/pdf' });
    await persistence.createPdfSession({
      document: { ...blankDocument('pdf-a', 'math.pdf'), pageCount: 9 },
      file: {
        blob: file,
        mimeType: 'application/pdf',
        size: file.size,
        originalName: 'math.pdf',
        lastModified: 10,
      },
    });
    const model = semanticModel();
    await persistence.saveSemanticPage({
      documentId: 'pdf-a',
      pageId: 'pdf-a-page-7',
      pageNumber: 7,
      model: model.toSerialized(),
    });
    await persistence.saveSession('pdf-a', { currentPage: 7, zoom: 125, zoomMode: 'custom' });
    await persistence.createBlankSession({ document: blankDocument('blank-a', '빈 캔버스') });

    const reopened = await persistence.openSession('pdf-a');
    const cached = await persistence.getPdfAnalysis('pdf-a', 'pdf-a-page-7');
    const incompatible = await persistence.getSemanticPage('pdf-a', 'pdf-a-page-7', {
      analysisVersion: PDF_ANALYSIS_VERSION + 1,
    });
    const byVoiceFileName = await persistence.findPdfSessionByOriginalFileName('MATH.PDF');

    expect(reopened?.session).toMatchObject({
      currentPage: 7,
      lastActivePageId: 'pdf-a-page-7',
      source: { kind: 'pdf', originalFileName: 'math.pdf', blobKey: 'pdf-a' },
    });
    expect(reopened?.file).toMatchObject({ size: file.size, originalName: 'math.pdf' });
    expect(cached?.analysisVersion).toBe(PDF_ANALYSIS_VERSION);
    expect(cached?.model).toEqual(model.toSerialized());
    expect(incompatible).toBeNull();
    expect(byVoiceFileName?.session.id).toBe('pdf-a');
  });
});

function createPersistence(): LocalEditorPersistence {
  const name = `note-session-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return new LocalEditorPersistence({ databaseName: name });
}

function blankDocument(id: string, name: string) {
  return { id, name, pageCount: 1, currentPage: 1, zoom: 100, zoomMode: 'custom' as const };
}

function semanticModel() {
  return buildPageSemanticModel({
    documentId: 'pdf-a',
    pageId: 'pdf-a-page-7',
    pageNumber: 7,
    textItems: [{
      id: 'text-1',
      text: 'A stable semantic page.',
      bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.03 },
      sourceIndex: 0,
      direction: 'ltr',
      hasEOL: true,
      orientation: { angle: 0, writingMode: 'horizontal' },
      axis: { advanceX: 1, advanceY: 0, normalX: 0, normalY: 1 },
    }],
    layoutDetections: [{
      id: 'layout-1',
      label: 'Text',
      bounds: { x: 0.05, y: 0.05, width: 0.8, height: 0.2 },
      confidence: 0.95,
      modelId: 'layout-model',
    }],
    layoutModelId: 'layout-model',
  });
}
