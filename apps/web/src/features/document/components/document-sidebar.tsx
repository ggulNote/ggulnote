import type { NoteSession } from "../local-persistence";
import { RecentSessions } from "./recent-sessions";

type DocumentSidebarProps = {
  totalPages: number;
  currentPage: number;
  onMove: (page: number) => void;
  disabled: boolean;
  sessions: readonly NoteSession[];
  activeSessionId: string | null;
  sessionSwitching: boolean;
  onOpenSession: (sessionId: string) => void;
};

export function DocumentSidebar({
  totalPages,
  currentPage,
  onMove,
  disabled,
  sessions,
  activeSessionId,
  sessionSwitching,
  onOpenSession,
}: DocumentSidebarProps): React.ReactElement {
  const pages = Array.from({ length: Math.max(0, totalPages) }, (_, index) => index + 1);

  return (
    <div className="space-y-4">
      <RecentSessions
        sessions={sessions}
        activeSessionId={activeSessionId}
        disabled={sessionSwitching}
        onOpen={onOpenSession}
      />
      <aside className="rounded-lg border border-slate-200 bg-white p-4" aria-label="문서 페이지 목록">
      <h2 className="text-sm font-semibold text-slate-700">페이지 목록</h2>
      <div className="mt-3 max-h-72 overflow-y-auto">
        {pages.length === 0 ? (
          <p className="text-sm text-slate-500">문서를 열면 페이지 목록이 표시됩니다.</p>
        ) : (
          <ul className="space-y-1">
            {pages.map((page) => (
              <li key={page}>
                <button
                  type="button"
                  onClick={() => onMove(page)}
                  disabled={disabled}
                  className={`w-full rounded border px-2 py-1 text-left text-sm ${
                    page === currentPage
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-700"
                  }`}
                  aria-current={page === currentPage ? "page" : undefined}
                >
                  {page}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </aside>
    </div>
  );
}
