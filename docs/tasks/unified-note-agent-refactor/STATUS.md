# Unified Note Agent Refactor — STATUS

## Current State

```text
Phase: 4 — Prompt Parts / Registered Actions / Atomic Prepare-Commit
Status: IMPLEMENTED / PRODUCTION-DEFAULT CUTOVER STILL GATED
Current Milestone: Phase 4 consolidation complete; collect live parity before default cutover
Date: 2026-08-14
```

Phase 4는 Phase 1~3 production-capable path를 폐기하지 않고 Context Parts,
registered Action prepare, central commit 책임으로 정리했다. explicit
`NEXT_PUBLIC_NOTE_AGENT_ROUTE=production` path에는 적용됐지만 live model parity가 없으므로
flag가 없을 때의 legacy default는 유지한다.

## Branch / Base

```text
source branch: refactor/unified-note-agent
Phase 3 completed/source HEAD: d1c6d2e1ade0ba0118cd6716f317c7fa0901f5bc
Phase 4 branch: refactor/note-agent-parts-actions
working tree at start: untracked next, pnpm
preserved unrelated files: next, pnpm
```

## Production Flow

```text
CompletedVoiceTurn
→ NoteContextAssembler
→ One Note Decision
→ NoteToolRegistry lookup + strict input
→ NoteTool.prepare (transaction authority 없음)
→ prepared batch validation
→ EditorNoteAgentTransaction.commit once
→ EditorEngine / CommandManager / operation event / Undo
```

- `NoteContextAssembler`는 enabled action schema를 한 번 load하고 Prompt Part를 deterministic
  priority 순으로 조립한다.
- `ObjectHandle`의 실제 ID/EntityRef는 request-local map에만 있고 Decision projection에는 없다.
- `NoteRuntime`은 최대 4 step을 순차 prepare하며 earlier-step output만 bind한다. 모든 mutation은
  준비가 끝난 뒤 transaction port를 한 번 호출한다.
- 같은 page의 direct text/annotation batch는 `CompositeEditorCommand` 하나, operation event 하나,
  undo 하나다. child failure는 앞선 child를 rollback한다.
- Stage 4 candidate/VLM/preview는 `preparePlacement`에서 side effect 없이 완료하고,
  `executePrepared`가 final guard와 Editor commit만 수행한다.

## Prompt Parts / Projection

Always-on:

- `user-turn`
- `frozen-context`
- selection/focus가 있을 때 compact `selection-focus`
- output이 있을 때 최근 3개의 `recent-operations`

Conditional:

- `object-detail`: selection/focus의 part/property가 실제로 필요할 때
- `candidates`: 실제 ambiguity 후보 최대 6개
- `screenshot-crop`: visual fallback descriptor; 실제 image payload는 Stage 4 observation이 소유

Projection은 기존 `SceneObject`/UnifiedObjectWorld/ObjectIndex에서 파생한다. appearance,
semantic, lifecycle, capability는 실제 metadata만 사용하며 screenshot/LLM으로 backfill하지 않는다.
full Scene/PDF/history, screenshot bytes, persistent object/part ID는 일반 Decision trace에 없다.

## Registered Actions

Enabled production-capable actions:

```text
text.create
text.replace
annotation.apply
navigation.next_page
navigation.previous_page
history.undo
math.add
math.matrix_multiply
```

- 모든 enabled Action은 description, examples, strict input/output schema, `prepare`를 갖는다.
- math actions는 pure COMPUTE이고 operation이 없다.
- `graph.add_tangent`, `table.update_cell`은 strict unavailable contract다.
- `math.create`, generic object move/delete/style은 stable renderer/compiler가 없어 등록하지 않았다.

## Ambiguity / Visual

- World ambiguity는 실제 `C1..C6` 후보만 같은 Decision provider의 candidate-only schema에 최대
  한 번 전달한다.
- Stage 4는 deterministic gate 후 실제 visual ambiguity에서만 screenshot crop/VLM을 최대
  한 번 사용하며 출력은 `S* | NONE`이다.
- 새 Note path는 VLM에 raw transcript를 다시 전달하지 않고 structured `Destination | null`을
  전달한다.
- unspecified `BESIDE`의 좌/우 동률은 한쪽으로 silent fallback하지 않고 ambiguity/no-commit이다.

## Atomicity / Safety

- prepare context에는 transaction port가 없다.
- invalid input/output, not-found, ambiguity, stale, unavailable, later-step prepare failure는 commit 0이다.
- direct mutation batch success는 transaction/event/undo 각각 1개다.
- spatial prepare는 VLM/preview 후에도 persistent mutation 0이며 prepared result commit만 1회다.
- control + mutation 또는 spatial + 다른 mutation batch는 현재 commit 전에 explicit unsupported다.
- PDF/Blank는 같은 Decision/Action/Runtime path를 사용하고 mutation 차이는 SceneObject capability다.
- Stage 3.5 exact/fuzzy/semantic resolver와 Stage 4 geometry/preview/final guard를 그대로 재사용한다.

## Diagnostics / Latency

Trace fields:

```text
contextAssemblyMs, decisionMs, decisionCallCount,
prepareMs, worldResolveMs/resolverMs, placementMs, computeMs,
disambiguationMs, visualFallbackMs/visualMs, visualCallCount,
guardMs, commitMs, renderMs, endToVisibleMs,
usedAmbiguityPass, usedVisualFallback
```

tool별 aggregator는 context/decision/prepare/commit/end-to-visible p50/p90/p95를 계산한다.
deterministic fixture로 percentile 계산만 검증했으며 실제 OpenAI/network 표본은 없다.
`renderMs=0`은 Editor subscriber 뒤 paint completion이 별도 관측되지 않는다는 뜻이고
`endToVisibleMs`도 현재 route completion proxy다.

## Verification

```text
Context/Decision/Runtime/transaction targeted: PASS
Stage 4 prepare/VLM/preview/prepared-commit targeted: PASS
production/shadow/latency/action targeted: PASS
Web full (Stage 2/3/3.5/4 + persistence): 137 files / 964 tests PASS
Editor Core full: 7 files / 54 tests PASS
Web strict typecheck: PASS
Editor Core strict typecheck: PASS
Web targeted lint: PASS
Editor Core targeted lint: PASS (existing config warnings only)
git diff --check: PASS
```

Environment/known output:

- repository Node requirement: `>=22`
- validation runtime: Node `20.19.4`, pnpm `10.9.0`
- engine mismatch warning, expected invalid-provider stderr, jsdom canvas stderr,
  Editor Core React/pages-directory lint warnings은 기존 known output이다.
- 실제 OpenAI/network, microphone, manual browser smoke는 실행하지 않았다.

## Deprecated Ledger

- legacy Direct/Spatial route와 `normalizeTextPlacementIntent`는 default rollback owner 때문에 남는다.
  새 Note path는 해당 natural-language normalizer를 호출하지 않는다.
- `DirectEditorCommand`는 `EditorNoteAgentTransaction`의 existing-editor compile adapter 안에만 남는다.
- `buildDecisionInput`은 Phase 2 compatibility fixture 때문에 남으며 production assembler는 사용하지 않는다.
- `SpatialPlacementExecutionPipeline.execute`는 legacy caller를 위해 남고 새 Note path는
  `preparePlacement/executePrepared`를 사용한다.
- 제거 조건은 live representative parity, operating latency, production-default 전환,
  rollback 관찰, remaining mutation compiler parity다.

## Known Limitations / Next Milestone

1. live model/network representative parity와 운영 p50/p90/p95가 없다.
2. production default는 아직 legacy이며 새 path는 explicit opt-in이다.
3. mixed control/spatial mutation 및 cross-page batch는 atomic commit 전에 거부한다.
4. object move/delete/style, math.create, Graph/Table production mutation은 미지원이다.
5. glyph-level PDF subrange offset과 Editor render completion timestamp는 없다.

Next milestone은 새 기능 Agent가 아니라 live parity/cutover gate다. parity 승인 전에는 legacy
route나 normalizer를 삭제하지 않는다.

## Commits

```text
Phase 4 implementation: def3a1b refactor(note-agent): prepare registered actions before atomic commit
Phase 4 tests: ef725a3 test(note-agent): cover parts actions and bounded visual prepare
Phase 4 docs: this document commit
```
