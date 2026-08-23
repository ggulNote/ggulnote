import { describe, expect, it } from 'vitest';
import {
  createBlankSessionTitle,
  createPdfAnalysisCacheIdentity,
  shouldRunPdfAnalysis,
} from './session-domain';

describe('createBlankSessionTitle', () => {
  it('uses the first available simple blank canvas title', () => {
    expect(createBlankSessionTitle([])).toBe('빈 캔버스');
    expect(createBlankSessionTitle([{ title: '빈 캔버스' }])).toBe('빈 캔버스 2');
    expect(createBlankSessionTitle([
      { title: '빈 캔버스' },
      { title: '빈 캔버스 2' },
      { title: '강의 노트' },
    ])).toBe('빈 캔버스 3');
  });
});

describe('PDF analysis cache policy', () => {
  it('runs expensive analysis only for a matching cache miss', () => {
    const key = createPdfAnalysisCacheIdentity('session-a', 'page-7', 1);
    expect(shouldRunPdfAnalysis({ key, status: 'checking' }, key)).toBe(false);
    expect(shouldRunPdfAnalysis({ key, status: 'hit' }, key)).toBe(false);
    expect(shouldRunPdfAnalysis({ key, status: 'miss' }, key)).toBe(true);
    expect(shouldRunPdfAnalysis({ key: 'another-page', status: 'miss' }, key)).toBe(false);
  });
});
