import type { NoteSession } from '../local-persistence';

type RecentSessionsProps = {
  sessions: readonly NoteSession[];
  activeSessionId: string | null;
  disabled: boolean;
  onOpen: (sessionId: string) => void;
};

export function RecentSessions({
  sessions,
  activeSessionId,
  disabled,
  onOpen,
}: RecentSessionsProps): React.ReactElement {
  return (
    <aside className='rounded-lg border border-slate-200 bg-white p-4' aria-label='Recent Sessions'>
      <h2 className='text-sm font-semibold text-slate-700'>Recent Sessions</h2>
      {sessions.length === 0 ? (
        <p className='mt-2 text-sm text-slate-500'>No saved sessions.</p>
      ) : (
        <ul className='mt-2 space-y-1'>
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                type='button'
                disabled={disabled || session.id === activeSessionId}
                onClick={() => onOpen(session.id)}
                className='w-full rounded border border-slate-200 px-2 py-2 text-left disabled:bg-slate-100'
              >
                <span className='block truncate text-sm font-medium text-slate-800'>{session.title}</span>
                <span className='block text-xs text-slate-500'>
                  {session.kind} · {new Date(session.lastOpenedAt).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
