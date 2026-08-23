# Persistent Note Sessions - Status

## Branch

`feat/persistent-note-sessions`

## Current State

- 기존 Dexie database를 version 4로 확장하고 `documents`를 Session manifest로 재사용.
- `documentFiles`의 PDF blob, `pageSnapshots`의 TLStore, `semanticPages`의 versioned analysis를 Session API로 묶음.
- blank/PDF Session create/list/open/save와 filename lookup을 추가하고 Recent Sessions에서 전환 가능.
- page/session 이동 전 현재 TLStore와 view state를 flush하고 last page/zoom을 복구.
- `PDF_ANALYSIS_VERSION = 1` cache hit에서는 persisted semantic model을 직접 복원하고 text extraction/자동 YOLO/semantic generation을 생략.
- 동일 TLStore snapshot 재저장은 revision을 증가시키지 않음.
- tldraw page restore 완료 시 persisted editor snapshot과 `contextRevision`을 한 번 캡처해 `PAGE_BASE`로 activate.
- activation 동안 `PAGE_BASE`는 유지되고 현재 catalog와의 create/update/delete 차이만 `LIVE_SCENE`에 반영.
- page/session 재진입 시 저장된 snapshot으로 rebase하며, 동일 revision/state는 동일한 base content를 생성.
- 신규 page record는 `contextRevision`을 저장하고 기존 record는 legacy `revision`을 그대로 사용.
- production Note Decision model은 `gpt-5.6-terra`이며 explicit prompt cache breakpoint 지원 대상임을 공식 OpenAI 문서에서 확인.
- Decision과 warmup이 동일한 builder에서 `STATIC -> PAGE_BASE` prefix와 strict schema/action ordering을 생성.
- STATIC/PAGE_BASE `input_text` block에 explicit breakpoint를 두고 dynamic LIVE/marked screenshot/voice를 뒤에 유지.
- Session 단위 `ggulnote:<sessionId>` cache key와 `prompt_cache_options.mode=explicit`을 Responses request에 적용.
- page activation은 UI를 block하지 않고 background warmup을 예약하며 `sessionId/pageId/contextRevision` in-memory dedupe를 사용.
- `cachedInputTokens`와 `cacheWriteInputTokens`를 transport, same-origin provider, Note trace로 전달.
- VoiceTurn bridge가 첫 `capturing` 상태를 production route에 한 번 전달해 speech-start frozen scene에서 LIVE_SCENE과 marked screenshot을 한 번 준비.
- visual warmup과 실제 Decision이 같은 prepared visual payload를 사용하며 Decision은 warmup Promise를 기다리지 않음.
- prompt는 `STATIC -> PAGE_BASE -> LIVE -> SCREENSHOT -> VISUAL_CONTEXT_END -> VOICE` 순서이고 visual sentinel에 세 번째 explicit breakpoint를 둠.
- speech/warmup/Decision timing과 cache read/write token을 turn trace에 기록하고 `[NOTE_VISUAL_CACHE_TRACE]` lifecycle trace를 추가.
- 현재 action registry에는 PDF open 음성 action이 없으므로 새 action을 추가하지 않고 filename Session lookup API까지만 제공.

## Completed Milestone

`M4 (Speech-start visual-prefix warmup)` 완료.

## Current Milestone

없음.

## Known Problems

- 전체 web test의 기존 `editor-shell.test.tsx` 4건은 jsdom `image.decode is not a function`으로 실패한다.
- 저장소 요구 Node는 `>=22`이나 현재 검증 환경은 `v20.19.4`다.
- PDF semantic/layout analysis는 기존 page-scoped pipeline을 유지해 각 page 최초 activation에서 한 번 수행된다.
- 실제 OpenAI A/B benchmark는 검증 환경에 `.env`/`OPENAI_API_KEY`가 없어 실행하지 못했다. 실사용 비교에 필요한 telemetry는 구현됨.

## Next Milestone

없음. Persistent Note Sessions의 계획된 M1-M4 완료.
