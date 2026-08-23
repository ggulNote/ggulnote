# Persistent Note Sessions - Decisions

## D1. Existing IndexedDB stores remain the persistence framework

- `documents`를 Session manifest, `documentFiles`를 PDF asset, `pageSnapshots`를 page editor state, `semanticPages`를 PDF analysis로 사용한다.
- 두 번째 database나 persistence framework를 만들지 않는다.

## D2. Session is the product domain name

- UI/application API는 `NoteSession`과 create/open/save Session 용어를 사용한다.
- 기존 저장 record와 store 이름은 호환성과 최소 migration을 위해 유지한다.
- object identity는 기존 page-scoped ID에 Session ID를 포함한 persistence key로 구분한다.

## D3. PDF analysis has one explicit invalidation version

- `PDF_ANALYSIS_VERSION`만 analysis cache invalidation에 사용한다.
- cache 없음, version 불일치, serialized model 손상일 때만 text extraction, YOLO, semantic generation을 수행한다.
- pdf.js page rendering은 Session reopen 때 다시 수행할 수 있다.

## D4. TLStore remains the canvas source of truth

- existing tldraw snapshot serializer/loader를 그대로 사용한다.
- debounced save를 유지하고 page/session switch 전에 명시적으로 flush한다.
- 동일 snapshot 재저장은 page revision을 올리지 않는다.

## D5. Large work is split at runtime boundaries

- M1은 Session/PDF persistence와 switching까지만 구현한다.
- M2가 PAGE_BASE activation/rebase를 소유한다.
- M3가 OpenAI prompt cache/warmup을 소유한다.

## D6. Visual prefix belongs to the VoiceTurn frozen context

- speech-start에서 기존 frozen scene을 기준으로 LIVE_SCENE과 marked screenshot을 한 번 준비한다.
- visual warmup과 실제 Decision은 같은 prepared payload를 사용한다.
- warmup 완료 여부는 correctness나 Decision 시작 조건이 아니다.
- page activation warmup은 STATIC/PAGE_BASE, speech-start warmup은 visual prefix까지 담당한다.
