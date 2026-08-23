import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NoteSession } from '../local-persistence';
import { RecentSessions } from './recent-sessions';

describe('RecentSessions', () => {
  it('shows the minimal session metadata and opens a saved session', () => {
    const onOpen = vi.fn();
    render(
      <RecentSessions
        sessions={[session()]}
        activeSessionId={null}
        disabled={false}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText('math.pdf')).toBeInTheDocument();
    expect(screen.getByText(/^pdf ·/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /math\.pdf/i }));
    expect(onOpen).toHaveBeenCalledWith('session-a');
  });
});

function session(): NoteSession {
  return {
    id: 'session-a',
    kind: 'pdf',
    title: 'math.pdf',
    createdAt: 1,
    updatedAt: 2,
    lastOpenedAt: 3,
    lastActivePageId: 'session-a-page-7',
    pageCount: 9,
    currentPage: 7,
    zoom: 100,
    zoomMode: 'custom',
    source: {
      kind: 'pdf',
      originalFileName: 'math.pdf',
      blobKey: 'session-a',
    },
  };
}
