# Unified Note Agent Refactor — STATUS

## Current State

```text
Phase: 3 — Production Cutover / Cleanup / Extensibility Proof
Status: IMPLEMENTED / DEFAULT CUTOVER BLOCKED
Current Milestone: close the production-default cutover gate
Date: 2026-08-13
```

Phase 3의 guarded production runtime과 확장성 증명은 구현했다. 그러나 Phase 2에
real model/network parity sample이 없고 Stage 4의 visual-only placement ambiguity를
새 runtime이 안전하게 이어받는 경계가 아직 없으므로 production 기본값 전환과 legacy
의미 계층 삭제는 완료로 표시하지 않는다.

## Branch / Base

```text
branch: refactor/unified-note-agent
Phase 3 start HEAD: 12a3d80e872201cba9ba9300d8a81930a05618c0
base: feat/stage-4.5-accuracy-improvements @ fc61be5
working tree at start: untracked next, pnpm
preserved unrelated files: next, pnpm
```

## Production Routing

- `CompletedVoiceTurn → One Note Decision → NoteRuntime → Existing Editor Runtime` 경로를
  `NoteAgentProductionRoute`로 구성했다.
- `NEXT_PUBLIC_NOTE_AGENT_ROUTE=production`을 명시할 때만 새 경로가 commit owner다.
  `shadow`는 Phase 2 no-commit 비교 경로이고, flag가 없으면 기존 route가 rollback 기본값이다.
- 한 production route는 기존 execution registry를 이용해 같은 `turnId`를 exactly once로
  처리한다. 동시에 들어온 duplicate turn도 같은 결과를 공유하며 decision/transaction은
  각각 한 번만 실행한다.
- `NoteRuntime`은 validation/resolve/placement/guard를 먼저 완료한 뒤 단일
  `NoteTransactionPort`로 commit한다. tool handler는 Editor port를 직접 갖지 않는다.
- 하나의 mutation은 기존 `EditorDirectCommandExecutor` 또는
  `SpatialPlacementExecutionPipeline`으로 compile된다. stale/failure/ambiguity는 commit 0이다.
- 여러 mutation step의 진짜 atomic transaction은 기존 Editor 경계가 제공하지 않아
  commit 전에 `MULTI_MUTATION_BATCH_UNSUPPORTED`로 거부한다. pure compute batch는 최대 4다.

## Ambiguity / Visual Boundary

- WorldResolver의 실제 후보만 `C1`–`C6` compact alias로 같은 Decision provider에 최대
  한 번 전달한다. 응답은 candidate alias 또는 `NONE`만 허용하며 ID/좌표 생성은 거부한다.
- Stage 4 placement 후보(`S*`)는 text-only disambiguation으로 성공 처리하지 않는다.
  deterministic dominance가 없으면 no-commit 상태로 남는다.
- 기존 Stage 4 VLM은 legacy compatibility route에 그대로 유지했다. 새 runtime에서
  candidate crop/preview/final guard까지 안전하게 연결하는 작업이 default cutover blocker다.

## Unified Objects / Parts

- Phase 1 `SceneObject`/UnifiedObjectWorld/ObjectIndex/OperationLedger를 그대로 사용한다.
- math/graph/table의 optional part metadata 경계를 추가했다. graph curve와 table
  row/column/cell은 parent를 resolve한 뒤 `DeterministicPartResolver`가 실제 part ID를 찾는다.
- LLM 계약은 declarative part kind/attributes만 허용하며 실제 `partId`는 계속 금지한다.
- math object는 canonical expression metadata와 deterministic root expression boundary를 갖는다.

## Tool Registry / Extensibility Proof

- production-capable registry: `text.create`, `text.replace`, `annotation.apply`,
  `navigation.next_page`, `navigation.previous_page`, `history.undo`, `math.add`,
  `math.matrix_multiply`.
- `math.add`와 `math.matrix_multiply`는 React/Editor와 독립된 pure compute tool이다.
  finite-number, rectangular matrix, shape/dimension을 strict하게 검증한다.
- incompatible dimensions는 `FAILED / INCOMPATIBLE_MATRIX_DIMENSIONS`이고 side effect는 0이다.
- 두 math tool은 중앙 command union/switch를 수정하지 않고 registry 등록만으로 compact
  Decision schema에 노출된다.
- `math.create`는 Formula renderer/create operation이 없어 노출하지 않았다.
- `graph.add_tangent`, `table.update_cell`은 strict contract와 unavailable boundary만 등록했으며
  Decision schema에는 노출되지 않는다.
- generic `object.move/delete/style`은 안전한 production compiler가 없으므로 노출하지 않았다.

## Diagnostics / Latency

Trace가 다음 값을 기록한다.

```text
decisionMs, llmCallCount, resolverMs, computeMs, placementMs,
disambiguationMs, visualMs, guardMs, commitMs, endToVisibleMs
```

tool별 nearest-rank p50/p90/p95 aggregator와 deterministic fixture를 추가했다. 실제
model/network 운영 표본은 없으므로 synthetic percentile 외의 latency 수치는 보고하지 않는다.
일반 성공 경로의 계약은 Decision LLM 1회, disambiguation 0회, visual 0회다.

## E2E / Safety Matrix

- 기본/page-region/relative create, user-created text/annotation anchor, PDF fuzzy range,
  ordinal/document scope, explicit target priority/not-found, PDF immutable capability는 Phase 2
  fixture와 Stage 3.5/4 회귀를 계속 통과한다.
- World ambiguity는 candidate-only second pass 한 번으로 제한된다.
- actual Editor annotation transaction에서 operation 1개와 undo 1개를 검증했다.
- stale scene, duplicate turn, unavailable tool, invalid matrix, multi-mutation batch는 persistent
  side effect 0을 검증했다.
- placement ambiguity의 Stage 4 visual handoff와 live model representative parity는 미완료다.

## Verification

```text
Phase 1–3 Note Agent targeted: 15 files / 75 tests PASS
Web full (Stage 2/3/3.5/4 포함): 136 files / 954 tests PASS
Editor Core full: 7 files / 53 tests PASS
Web typecheck: PASS
Editor Core typecheck: PASS
Web targeted lint: PASS
Editor Core targeted lint: PASS (existing config warnings only)
git diff --check: PASS
```

Environment:

- repository requirement: Node `>=22`
- validation runtime: Node `20.19.4`, pnpm `10.9.0`
- engine mismatch, Editor Core React/pages-directory lint warning, Web validation stderr와 jsdom
  canvas stderr는 기존 environment/known output이며 테스트 결과는 PASS다.

## Deprecated Ledger

- `normalizeTextPlacementIntent`, regex placement interpretation, `DirectCommandPlanningPipeline`,
  legacy Direct/Spatial route, `DIRECT_COMMAND_NAMES`, `DirectEditorCommand`는 삭제하지 않았다.
- 새 production core는 이 자연어 normalizer와 fixed command-name 목록을 사용하지 않는다.
  `DirectEditorCommand`는 기존 Editor compiler/history compatibility adapter 안에서만 남는다.
- 제거 조건은 (1) real model representative parity 승인, (2) Stage 4 visual ambiguity의 guarded
  handoff, (3) 현재 stable mutation 전체의 unified compiler, (4) production 기본값 전환 후
  rollback 관찰 기간 완료다.
- Stage 3.5 fuzzy/semantic grounding과 Stage 4 candidate/preview/validation/final guard는 deprecated가
  아니며 facade 뒤에서 유지한다.

## Known Limitations / Cutover Gate

1. real model/network representative parity와 real p50/p90/p95 표본이 없다.
2. 새 runtime의 ambiguous Stage 4 candidate → bounded VLM → preview/final guard 연결이 없다.
3. production은 명시적 opt-in이고 기본값은 legacy다.
4. multi-mutation atomic batch는 안전하게 preflight reject하며 rollback transaction은 미지원이다.
5. object move/delete/style, math.create, graph/table production mutation은 미지원이다.

## Commits

```text
phase 1 implementation: 4ab6d3a feat(scene): add unified object world foundation
phase 1 status: 46eed4e docs(note-agent): record phase 1 status
phase 2 implementation + tests: 7f1ed19 feat(note-agent): add shadow decision runtime
phase 2 status: 12a3d80 docs(note-agent): record phase 2 status
phase 3 implementation + tests: b8ff0e2 feat(note-agent): add guarded production runtime
phase 3 status: this document commit
```

## Next Milestone

```text
Production-default cutover gate
1. collect and approve real shadow/model parity and latency
2. connect Stage 4 ambiguous visual selection without bypassing preview/final guard
3. rerun full E2E, then explicitly switch the default and observe rollback window
```
