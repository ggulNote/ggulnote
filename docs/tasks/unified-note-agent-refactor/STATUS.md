# Unified Note Agent Refactor — STATUS

## Current State

```text
Phase: 1 — Unified Object World Foundation
Status: COMPLETE
Current Milestone: COMPLETE / READY FOR PHASE 2 REVIEW
Date: 2026-08-13
```

## Branch / Base

```text
original branch: feat/stage-4.5-accuracy-improvements
original HEAD: fc61be53f37580ebc0ba5a794264d70d390d1dd4
branch: refactor/unified-note-agent
base: feat/stage-4.5-accuracy-improvements @ fc61be5
working tree at start: untracked next, pnpm
preserved unrelated files: next, pnpm
```

## Existing Architecture

- Canonical scene: `packages/editor-core/src/scene-core/types.ts`,
  `scene-snapshot.ts`, `pdf-scene-adapter.ts`, `canvas-scene-adapter.ts`.
- Production user objects: `EditorEngine`의 `SerializedAnnotation` /
  `PageSceneSnapshot`; `LocalEditorPersistence`가 기존 IndexedDB
  `pageSnapshots`와 `operations`에 저장한다.
- `CanvasObjectStore`는 Scene Core generic source이며 현재 production Text source는
  annotation snapshot이다.
- Grounding은 기존 `PageTargetCatalog`, `TargetStrategyRouter`,
  `FrozenTargetResolver`, Canonical Text Stream을 유지한다.
- Spatial은 기존 `ExistingSceneSpatialSceneSource`, `SpatialSceneObject`,
  `placement-candidate-engine`, Ghost Preview, deterministic validation을 유지한다.
- Mutation은 `EditorEngine → CommandManager → publishOperation → persistence`와 기존
  Undo/Redo를 그대로 사용한다.

## Phase 1 Implementation

- `SceneObjectMetadataView`가 source, canonical/render geometry, multi-rect,
  search/semantic/lifecycle/part/capability를 기존 `SceneObject`에서 파생한다.
- PDF는 immutable capability, Canvas/Annotation은 실제 lock/kind/rect 정책에 따른
  capability를 갖는다.
- user Text, underline, highlight는 stable annotation ID, canonical Scene ID,
  `createdByTurnId`, `creationOrder`, `targetObjectIds`, ordered rects를 refresh/hydrate
  뒤에도 보존한다.
- `ExistingUnifiedObjectWorld`가 기존 frozen snapshot source 뒤에서 PDF/Blank 공통
  snapshot/object/page lookup을 제공한다.
- `RebuildableObjectIndex`는 snapshot-derived in-memory index이며 revision/content hash,
  delta upsert/delete, full rebuild parity를 지원한다.
- `DirectCommandOperationLedgerAdapter`는 기존 direct history와 Editor operation ID를
  EntityRef output, turn, tool, undo group read model로 노출한다.
- `EditorOperation` metadata는 기존 Operation Log와 IndexedDB record를 그대로 통과한다.
- DB version/table 추가는 없다. legacy optional metadata는 추정하지 않는다.

## Verification

```text
Unified world + production adapter targeted: 6 files / 28 tests PASS
Editor targeted: 3 files / 35 tests PASS
Stage 3.5 + Stage 4 targeted: 10 files / 100 tests PASS
Final world/executor targeted: 2 files / 15 tests PASS
Editor Core full: 7 files / 53 tests PASS
Web full: 123 files / 886 tests PASS
Web typecheck: PASS
Editor Core typecheck: PASS
Web package lint: PASS
Editor Core package lint: PASS (existing config warnings only)
git diff --check: PASS
```

Web full regression 첫 실행에서 기존 flaky
`voice-debug-panel.test.tsx`의 fake-session timing 1건이 실패했다. 해당 파일 단독
재실행은 2/2 PASS였고, 최종 Web full rerun도 123 files / 886 tests PASS였다.

Environment:

- repository requirement: Node `>=22`
- validation runtime: Node `20.19.4`, pnpm `10.9.0`
- engine mismatch와 Editor Core React/pages-directory lint warning은 기존 환경 warning이다.

## Known Limitations

- world/index는 Phase 1 read boundary이며 production planner route에 아직 wiring하지 않았다.
- ObjectIndex는 source of truth가 아니며 현재 in-memory다; snapshot에서 rebuild해야 한다.
- legacy annotation/operation에는 `createdByTurnId`가 없을 수 있으며 이를 추정하지 않는다.
- production renderer가 별도 `renderBounds`를 제공하지 않는 object는 canonical `bounds`를
  fallback으로 사용한다.
- user Text range의 glyph/character-level address resolution은 Phase 1 범위가 아니다.
- session 밖 operation ledger hydration/cross-document query는 Phase 2 runtime wiring 전이다.
- Graph/Math/Table part metadata는 read-only contract/view이며 새 production capability가 아니다.

## Commits

```text
implementation: 4ab6d3a feat(scene): add unified object world foundation
status: docs(note-agent): record phase 1 status
```

## Next Milestone

```text
Phase 2 — One Decision + Tool Runtime Shadow Mode
```

Phase 2는 Phase 1 commit과 shadow/parity 검토 후 별도 세션에서 시작한다.
