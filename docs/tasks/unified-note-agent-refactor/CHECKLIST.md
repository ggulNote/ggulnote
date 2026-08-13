# Unified Note Agent Refactor — CHECKLIST

## Current Milestone

```text
Phase 3 — Production Cutover / Cleanup / Extensibility Proof
Status: IN PROGRESS / DEFAULT CUTOVER GATE BLOCKED
```

## Phase 1 / Phase 2 Foundation

- [x] `feat/stage-4.5-accuracy-improvements` base와 branch/working tree 확인
- [x] 기존 untracked `next`, `pnpm` 보존
- [x] SceneObject canonical world / ObjectIndex / OperationLedger adapter
- [x] PDF, user text, annotation 공통 lookup와 persistence/rebuild
- [x] strict EntitySelector / Destination / NoteDecision
- [x] dynamic NoteToolRegistry / WorldResolver / PlacementEngine facade
- [x] same-origin/server-only provider 재사용
- [x] shadow no-commit / Stage 3.5 fuzzy / Stage 4 geometry parity
- [x] 기존 EditorEngine / CommandManager / undo / persistence 경계 유지

## Phase 3 Production Runtime

- [x] CompletedVoiceTurn → Decision → NoteRuntime → existing Editor transaction 구성
- [x] explicit `NEXT_PUBLIC_NOTE_AGENT_ROUTE=production` opt-in flag
- [x] no flag legacy rollback path / explicit shadow mode 유지
- [x] 한 turn 한 commit owner / concurrent duplicate exactly once
- [x] strict input/output / pre/post scene revision guard
- [x] one mutation one transaction / actual Editor operation one undo test
- [x] failure, stale, ambiguity side effect 0
- [x] multi-mutation batch를 commit 전 명시적으로 거부
- [ ] representative parity 승인 후 production을 기본값으로 전환
- [ ] 여러 mutation을 위한 실제 atomic rollback transaction

## Ambiguity / Visual

- [x] WorldResolver 실제 후보 최대 6개만 compact alias로 제공
- [x] 같은 provider를 이용한 candidate-only second pass 최대 1회
- [x] candidate alias/`NONE` 외 응답 및 generated ID/coordinate 거부
- [x] Stage 4 placement ambiguity를 임의 성공/commit으로 바꾸지 않음
- [ ] 새 runtime에서 Stage 4 bounded VLM/preview/final guard까지 안전하게 연결

## Dynamic Tools / Object Parts

- [x] `math.add` pure compute / strict finite-number validation
- [x] `math.matrix_multiply` pure compute / rectangular shape와 dimension validation
- [x] 중앙 command union/switch 수정 없이 registry 등록 및 Decision schema 노출
- [x] graph curve, table row/column/cell, math expression part metadata boundary
- [x] parent resolve 후 deterministic PartResolver / 실제 partId는 LLM에서 금지
- [x] `graph.add_tangent`, `table.update_cell` unavailable contract boundary
- [x] renderer/compiler가 없는 `math.create`를 fake mutation으로 만들지 않음
- [ ] generic object move/delete/style production adapter
- [ ] Graph/Table production mutation

## Cleanup / Deprecated Ledger

- [x] 새 production core는 raw transcript placement normalizer를 사용하지 않음
- [x] 새 registry는 `DIRECT_COMMAND_NAMES`에 의존하지 않음
- [x] `DirectEditorCommand` 의존을 existing-editor compatibility adapter로 격리
- [x] Stage 3.5 grounding과 Stage 4 placement/validation 자산 유지
- [x] legacy normalizer/route/fixed union 유지 이유와 제거 조건 기록
- [ ] default cutover와 rollback 관찰 뒤 legacy 의미 route 제거

## Diagnostics / Evaluation

- [x] decision/resolver/compute/placement/disambiguation/visual/guard/commit/end-to-visible metrics
- [x] tool별 p50/p90/p95 aggregator와 deterministic unit fixture
- [x] Decision 일반 경로 LLM 1회 계약
- [x] deterministic E2E/safety fixtures
- [ ] real model/network representative parity sample
- [ ] 운영 p50/p90/p95와 visual fallback latency sample

## Verification

- [x] Note Agent targeted 15 files / 75 tests
- [x] Web full 136 files / 954 tests
- [x] Editor Core full 7 files / 53 tests
- [x] Stage 2/3/3.5/4 regression
- [x] persistence/refresh tests
- [x] Web strict typecheck
- [x] Editor Core strict typecheck
- [x] targeted Web/Editor lint
- [x] `git diff --check`
- [ ] production-default cutover 후 최종 full E2E 재검증
