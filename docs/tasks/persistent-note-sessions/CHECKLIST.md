# Persistent Note Sessions - Checklist

## M1 - Persistent session lifecycle

- [x] 시작 전 branch/worktree 확인
- [x] develop fast-forward pull 및 작업 branch 생성
- [x] IndexedDB/PDF/YOLO/semantic/tldraw/session restore 경로 조사
- [x] production model과 OpenAI explicit cache 지원 조사
- [x] NoteSession domain view와 IndexedDB migration
- [x] create/list/open/save Session API
- [x] page/session switch 전 TLStore와 view state flush
- [x] Recent Sessions 최소 UI와 last page restore
- [x] PDF analysis version/cache hit restore 및 재분석 방지
- [x] session/PDF cache trace
- [x] persistence/PDF/last-page focused tests
- [x] web typecheck/test/lint 및 git diff check
- [x] STATUS/CHECKLIST 완료 상태 갱신

## M1 검증 결과

- [x] `pnpm --filter web typecheck`
- [x] `pnpm --filter web lint`
- [x] Session/PDF/UI/migration focused tests - 14/14 통과
- [ ] 전체 web test - 1040/1044 통과, 기존 `editor-shell.test.tsx` 4건은 jsdom `image.decode is not a function`으로 실패
- [x] `git diff --check`

## M2 - Page activation baseline

- [x] activation 시 persisted PAGE_BASE freeze
- [x] activation 중 PAGE_BASE 불변 / LIVE_SCENE delta
- [x] leave/re-entry rebase
- [x] actual persisted change 기반 contextRevision
- [x] lifecycle tests

## M2 검증 결과

- [x] `pnpm --filter web typecheck`
- [x] `pnpm --filter web lint`
- [x] PAGE_BASE/assembler/editor activation/persistence focused tests - 17/17 통과
- [ ] 전체 web test - 1045/1049 통과, 기존 `editor-shell.test.tsx` 4건은 jsdom `image.decode is not a function`으로 실패
- [x] `git diff --check`

## M3 - Prompt cache and warmup

- [x] stable/dynamic prefix builder
- [x] Session 단위 prompt_cache_key
- [x] GPT-5.6 explicit breakpoints
- [x] non-blocking warmup과 in-memory dedupe
- [x] cache read/write telemetry 및 trace
- [x] ordering/cache key/dynamic isolation/warmup tests

## M3 검증 결과

- [x] `pnpm --filter @ggulnote/web typecheck`
- [x] `pnpm --filter @ggulnote/web lint`
- [x] Prompt/provider/route/transport focused tests - 32/32 통과
- [ ] 전체 web test - 1049/1053 통과, 기존 `editor-shell.test.tsx` 4건은 jsdom `image.decode is not a function`으로 실패
- [x] `git diff --check`
