# Unified Note Agent Refactor — CHECKLIST

## Current Milestone

```text
Phase 2 — One Decision + Tool Runtime Shadow Mode
Status: COMPLETE
```

## Preflight

- [x] original branch/HEAD/working tree 확인
- [x] `AGENTS.md` 확인
- [x] Stage 3 / 3.5 / 4 문서 확인
- [x] `IMPLEMENTATION.md` 확인
- [x] 사용자 확인에 따라 `feat/stage-4.5-accuracy-improvements`를 base로 사용
- [x] `refactor/unified-note-agent` branch 생성
- [x] 기존 untracked `next`, `pnpm` 보존

## Existing Architecture

- [x] SceneObject / SceneSnapshot / objectById / canonical Rect 조사
- [x] CanvasObjectStore / PDF adapter / production annotation adapter 조사
- [x] SerializedAnnotation / PageSceneSnapshot / IndexedDB persistence 조사
- [x] EditorEngine / CommandManager / publishOperation / Undo/Redo 조사
- [x] Stage 3.5 TargetStrategyRouter / FrozenTargetResolver 조사
- [x] Stage 4 SpatialSceneSnapshot / candidate / preview / validation 조사
- [x] 기존 구조로 충족되는 기능을 새 subsystem으로 복제하지 않음

## Canonical Object World

- [x] SceneObject를 canonical entity로 유지
- [x] PDF_BASE / USER_CANVAS / USER_ANNOTATION source view
- [x] canonical bounds / optional renderBounds / annotation rects view
- [x] searchable/normalized text / canonical math / semantic attributes view
- [x] createdAt / updatedAt / createdByTurnId / creationOrder / readingOrder view
- [x] parent / part metadata boundary
- [x] anchorable / annotatable / editable / movable / resizable / deletable capability
- [x] textRangeAddressable / partAddressable capability
- [x] SpatialSceneObject를 SceneObject-derived read model로 유지

## Persistence / History

- [x] user Text stable annotation ID가 hydrate 후 같은 SceneObject ID로 복원
- [x] underline/highlight rects와 target object refs persistence
- [x] annotation lifecycle metadata additive persistence
- [x] EditorOperation sourceTurnId / toolId / undoGroupId 연결
- [x] 기존 CommandManager / publishOperation / Operation Log / Undo 경로 유지
- [x] IndexedDB schema/table 추가 없음
- [x] legacy annotation hydration 유지

## Facade / Index / Ledger

- [x] UnifiedObjectWorld snapshot/object/page lookup
- [x] SceneObject metadata lookup
- [x] PDF/Blank 공통 ObjectIndex 검색
- [x] kind/content/source/page/semantic attribute 검색
- [x] creation/reading order deterministic sort
- [x] scene revision + content hash invalidation
- [x] create/update/delete delta update
- [x] source snapshot rebuild parity
- [x] Direct operation history read-model adapter
- [x] output EntityRef / sourceTurnId / toolId / undoGroupId

## Verification

- [x] Unified Object World targeted tests
- [x] user Text/annotation refresh persistence tests
- [x] ObjectIndex rebuild/delta/stale revision tests
- [x] Operation ledger/metadata tests
- [x] Stage 3.5 targeted regression
- [x] Stage 4 targeted regression
- [x] Editor Core full tests
- [x] Web strict typecheck
- [x] Editor Core strict typecheck
- [x] Web package lint
- [x] Editor Core package lint
- [x] `git diff --check`
- [x] 기존 `voice-debug-panel` flaky 단독 rerun PASS 확인

## Phase 2 Contract / Runtime

- [x] optional EntitySelector / spatial language / Destination
- [x] strict CALL/BATCH/NEEDS_INPUT/UNSUPPORTED/NO_OP parser
- [x] max selector depth 2 / max atomic batch 4
- [x] unknown fields와 IDs/coordinates/bounds/offsets 거부
- [x] dynamic namespaced NoteTool Registry와 availability/schema
- [x] text create/replace, annotation, navigation, undo adapter
- [x] Phase 1 World/ObjectIndex/Operation adapter 재사용
- [x] Stage 3.5 resolver facade / explicit miss no fallback
- [x] Stage 4 placement facade / user-created renderBounds anchor
- [x] strict runtime / stale guard / shadow commit port 없음

## Phase 2 Provider / Shadow / Verification

- [x] existing same-origin/server-only model transport 재사용
- [x] AbortSignal / strict response / available-tool authority
- [x] compact input / dynamic tool schemas / one decision call
- [x] explicit `NEXT_PUBLIC_NOTE_AGENT_SHADOW_MODE=1` flag
- [x] existing route 단독 commit owner / shadow failure isolation
- [x] bounded parity/latency/no-commit trace
- [x] deterministic parity fixtures 12종
- [x] Note Agent targeted 9 files / 53 tests
- [x] Web full 131 files / 936 tests
- [x] Editor Core full 7 files / 53 tests
- [x] Web/Editor typecheck와 lint
- [x] `git diff --check`

## Explicitly Deferred

- [x] Phase 2 — One Decision + Tool Runtime Shadow Mode
- [x] One Note Decision production provider (shadow only)
- [ ] NoteTool Registry production cutover
- [ ] 기존 Direct/Spatial route 제거
- [ ] Math/Graph/Table 새 production capability
- [ ] real model shadow/parity/latency sample review
- [ ] generic object move/delete/style production adapter
