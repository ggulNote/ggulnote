# Persistent Note Sessions - SPEC

## Goal

기존 `documents`, `documentFiles`, `pageSnapshots`, `semanticPages` IndexedDB 구조를 Note Session의 영속 저장소로 재사용한다.

```text
Session manifest -> documents
PDF source asset -> documentFiles
Page editor state -> pageSnapshots
PDF analysis -> semanticPages
```

Session 전환은 현재 page를 먼저 저장하고 대상 Session의 마지막 page, TLStore snapshot, PDF source와 semantic analysis를 복구한다. OpenAI Prompt Cache는 source of truth가 아니며 page activation 이후의 best-effort 최적화로만 둔다.

## Milestones

### M1 - Persistent session lifecycle

- 기존 IndexedDB store를 Session/Asset/Page 책임으로 확장
- `NoteSession` domain view와 PDF analysis version 추가
- blank/PDF Session create, list, open, save API 추가
- current tldraw page와 view state를 page/session switch 전에 flush
- Recent Sessions 최소 UI와 last page restore
- 저장된 PDF analysis가 유효하면 pdf.js rendering만 수행하고 text extraction/YOLO/semantic generation은 생략
- session identity가 `sessionId + pageId + objectId` 경계를 유지하는지 persistence 테스트
- session/PDF cache trace 추가

### M2 - Page activation baseline

- page activation 시 persisted current state로 `PAGE_BASE`를 freeze
- activation 동안 `PAGE_BASE` 유지, 변경분만 `LIVE_SCENE`에 반영
- page leave/re-entry 시 persisted state로 rebase
- 실제 page content가 바뀔 때만 `contextRevision` 증가
- page/session switch와 baseline lifecycle 단위 테스트

### M3 - Prompt cache and warmup

- prompt builder를 `STATIC -> PAGE_BASE -> LIVE -> SCREENSHOT -> VOICE` 경계로 정리
- Session 단위 `prompt_cache_key` 추가
- GPT-5.6 production model에서 explicit STATIC/PAGE_BASE breakpoint 적용
- 같은 prefix builder를 쓰는 non-blocking warmup 및 in-memory dedupe
- `cachedInputTokens`, `cacheWriteInputTokens` telemetry와 cache trace
- ordering, dynamic isolation, cache key, warmup dedupe 테스트

## Non-goals

- backend, server DB, RAG, vector DB
- 새로운 global state/event sourcing/state-machine framework
- cross-session object copy 자체
- Session dashboard 또는 대규모 `/editor` UI redesign
- multimodal one-decision route, action schema, NoteRuntime 재설계
