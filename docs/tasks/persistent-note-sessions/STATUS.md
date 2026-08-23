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
- production Note Decision model은 `gpt-5.6-terra`이며 explicit prompt cache breakpoint 지원 대상임을 공식 OpenAI 문서에서 확인.
- 현재 action registry에는 PDF open 음성 action이 없으므로 새 action을 추가하지 않고 filename Session lookup API까지만 제공.

## Completed Milestone

`M1 (Persistent session lifecycle)` 완료.

## Current Milestone

없음.

## Known Problems

- 전체 web test의 기존 `editor-shell.test.tsx` 4건은 jsdom `image.decode is not a function`으로 실패한다.
- 저장소 요구 Node는 `>=22`이나 현재 검증 환경은 `v20.19.4`다.
- PDF semantic/layout analysis는 기존 page-scoped pipeline을 유지해 각 page 최초 activation에서 한 번 수행된다.

## Next Milestone

`M2 (Page activation baseline)`
