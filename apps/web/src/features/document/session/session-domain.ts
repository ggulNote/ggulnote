import type { NoteSession } from '../local-persistence';

const BLANK_SESSION_TITLE = '빈 캔버스';

export type PdfAnalysisActivation = {
  key: string;
  status: 'checking' | 'hit' | 'miss';
};

export function createBlankSessionTitle(
  sessions: readonly Pick<NoteSession, 'title'>[],
): string {
  const titles = new Set(sessions.map((session) => session.title.trim()));
  if (!titles.has(BLANK_SESSION_TITLE)) return BLANK_SESSION_TITLE;
  for (let index = 2; index <= titles.size + 2; index += 1) {
    const candidate = BLANK_SESSION_TITLE + ' ' + String(index);
    if (!titles.has(candidate)) return candidate;
  }
  return BLANK_SESSION_TITLE + ' ' + String(titles.size + 2);
}

export function createPdfAnalysisCacheIdentity(
  sessionId: string,
  pageId: string,
  analysisVersion: number,
): string {
  return `${sessionId}:${pageId}:${analysisVersion}`;
}

export function shouldRunPdfAnalysis(
  activation: PdfAnalysisActivation | null,
  expectedIdentity: string,
): boolean {
  return activation?.key === expectedIdentity && activation.status === 'miss';
}
