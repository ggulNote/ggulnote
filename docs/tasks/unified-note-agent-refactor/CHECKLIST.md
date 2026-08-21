# Unified Note Agent Refactor — CHECKLIST

## Current Milestone

```text
Phase 5 — tldraw Object Catalog / One Decision
Status: IMPLEMENTED / DEFAULT VOICE OWNER CUT OVER
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
- [x] no-flag/`production` Phase 5 owner와 explicit shadow mode
- [x] `NEXT_PUBLIC_NOTE_AGENT_ROUTE=legacy` explicit rollback path
- [x] 한 turn 한 commit owner / concurrent duplicate exactly once
- [x] strict input/output / pre/post scene revision guard
- [x] one mutation one transaction / actual Editor operation one undo test
- [x] failure, stale, ambiguity side effect 0
- [x] Phase 3에서는 multi-mutation batch를 commit 전 명시적으로 거부
- [x] representative parity 승인 후 production을 기본값으로 전환
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
- [x] real model/network representative parity sample
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
- [x] production-default cutover 후 Web/Editor full automated 재검증
- [ ] production-default cutover 후 microphone/browser full E2E

## Phase 4 Prompt Parts

- [x] `NoteContextAssembler`가 enabled Action schema와 Part를 한 번 조립
- [x] deterministic priority/ID order와 bounded token estimate
- [x] user/frozen/selection-focus/recent-operation Part
- [x] object-detail/candidate/screenshot descriptor conditional Part
- [x] recent output 최대 3, ambiguity candidate 최대 6
- [x] full Scene/PDF/history/screenshot bytes를 일반 Decision/trace에서 제외
- [x] `ObjectHandle` → actual `EntityRef` request-local map
- [x] persistent object/part ID가 projection/Decision input에 노출되지 않음
- [x] appearance/semantic/lifecycle/capability는 실제 SceneObject metadata만 사용

## Phase 4 Registered Actions / Prepare

- [x] 기존 `NoteToolRegistry`와 naming 유지
- [x] 모든 enabled Action에 description/examples/strict input/output schema
- [x] Action `execute`를 side-effect-free `prepare` 경계로 전환
- [x] Action prepare context에서 transaction authority 제거
- [x] QUERY/COMPUTE operation 0, MUTATION prepared operation 1+ guard
- [x] `AllEnabledActionsLoader` 단일 구현
- [x] BATCH 최대 4, backward step-output reference만 허용
- [x] forward/circular/malformed reference strict reject
- [x] later-step prepare failure commit 0

## Phase 4 Atomic Commit

- [x] 모든 direct mutation prepare 뒤 `NoteTransactionPort.commit` 한 번
- [x] 같은 page direct mutation batch를 `CompositeEditorCommand` 하나로 실행
- [x] operation event 1, logical undo 1
- [x] child execute/toOperation 실패 시 completed child rollback
- [x] stale/not-found/ambiguity/invalid prepare side effect 0
- [x] commit 후 기존 history/operation/persistence observer 경계 유지
- [x] mixed control/spatial batch는 부분 commit 대신 pre-commit explicit unsupported

## Phase 4 Ambiguity / Visual

- [x] World candidate-only Decision second pass 최대 1회
- [x] Stage 4 candidate/VLM/preview를 `preparePlacement`에서 side effect 없이 실행
- [x] `executePrepared`가 final guard와 Editor commit만 실행
- [x] deterministic placement는 VLM 0, actual visual ambiguity는 VLM 최대 1
- [x] VLM output은 current `S* | NONE` alias만 허용
- [x] 새 Note path는 raw transcript 대신 structured `Destination | null` 사용
- [x] unspecified `BESIDE` 방향을 heuristic으로 선택하지 않음

## Phase 4 Verification

- [x] Context Parts / handle privacy / conditional omission tests
- [x] Action prepare no-transaction and later-step failure no-commit tests
- [x] direct atomic batch one event/undo and rollback tests
- [x] Stage 4 prepare no-mutation / prepared commit no-rerun tests
- [x] Web full 137 files / 964 tests
- [x] Editor Core full 7 files / 54 tests
- [x] Web/Editor strict typecheck
- [x] targeted Web/Editor lint
- [x] `git diff --check`
- [x] live model/network representative parity
- [ ] manual microphone/browser smoke
- [x] production default cutover
- [ ] rollback observation

## Phase 5 tldraw source of truth

- [x] requested base에서 새 branch 생성
- [x] dirty original worktree와 기존 untracked `next`, `pnpm` 보존
- [x] production path user-created canvas object의 mutable source를 TLStore로 전환
- [x] built-in tldraw text shape 재사용
- [x] multi-segment annotation을 하나의 logical custom shape로 투영
- [x] PDF.js base/semantic/text/glyph ownership 유지
- [x] Agent domain과 tldraw SDK 사이 `TldrawEditorAdapter` boundary
- [x] 기존 `pageSnapshots` IndexedDB record에 versioned snapshot/migration
- [x] 별도 DB와 TLStore/SceneObject dual mutable state 없음

## Phase 5 Object Catalog / One Decision

- [x] request마다 새 O-handle map 생성
- [x] 현재 페이지 user-created object 전체 compact catalog 포함
- [x] normalized bounds, capabilities, selection/focus/recent 반영
- [x] persistent ID, document-wide text, screenshot bytes 제외
- [x] 현재 페이지 PDF text-addressable paragraph의 full canonical `text` 제공
- [x] Canvas text와 PDF paragraph를 동일 Object Catalog `text` 계약으로 제공
- [x] raw PDF word object catalog 제외
- [x] enabled Action schema에서 strict discriminated JSON Schema 생성
- [x] Responses `text.format=json_schema`, `strict=true` 연결
- [x] Action prompt는 `id + description`, strict args는 response schema에만 제공
- [x] 짧은 One Decision system contract와 대표 사례
- [x] invalid O99는 commit 0
- [x] duplicate same-content object는 모델 handle 선택 또는 clarification/commit 0
- [x] 승인된 compact Object Catalog를 외부 OpenAI request에 포함
- [ ] standalone PDF sentence catalog projection

## Phase 5 No Fast Path / Resolver boundary

- [x] next page provider call 정확히 1
- [x] previous page provider call 정확히 1
- [x] undo provider call 정확히 1
- [x] production failure에서 legacy silent fallback 없음
- [x] user-created object command에서 primary/fuzzy/`anchorQuery` resolver 미호출
- [x] 선택된 PDF object 내부에서만 Stage 3.5 range alignment
- [x] 알고리즘이 LLM-selected handle을 다른 object로 교체하지 않음

## Phase 5 Prepare / Atomic tldraw

- [x] `Action.prepare` persistent side effect 0
- [x] 여러 mutation step prepare 후 tldraw transaction 1
- [x] 두 번째 prepare 실패 commit 0
- [x] commit child failure full rollback
- [x] stale scene commit 0
- [x] logical turn undo 1회
- [x] Operation Ledger를 semantic recent history로만 유지
- [x] normal visual call 0 / Stage 4 bounded visual call 최대 1
- [ ] first-decision `NEEDS_VISUAL` generic second pass

## Phase 5 Verification

- [x] tldraw projection/catalog/privacy/fresh handle tests
- [x] sequential typo/recent placement와 one-undo integration
- [x] primary resolver 미호출과 selected-PDF-only range test
- [x] no-fast-path Decision Provider count tests
- [x] rollback/undo/persistence/PDF-Blank common path regression
- [x] Node 22 Web full 141 files / 984 tests
- [x] Node 22 Editor Core full 7 files / 54 tests
- [x] Web/Editor strict typecheck
- [x] Web/Editor lint
- [x] `git diff --check`
- [x] browser Blank tldraw mount/text select/edit/refresh smoke
- [x] live OpenAI/network representative `O1 / BELOW` Decision
- [ ] microphone and full voice browser smoke
- [ ] PDF voice underline browser smoke
- [x] production-default cutover
- [ ] production rollback observation
- [x] full-text 변경 targeted Editor 24 / Web 54 tests, strict typecheck, changed-file lint
