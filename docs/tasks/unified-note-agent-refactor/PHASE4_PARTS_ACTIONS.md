# Unified Note Agent Phase 4 — Parts / Actions Mapping

## Baseline

```text
source branch: refactor/unified-note-agent
Phase 3 start HEAD: d1c6d2e1ade0ba0118cd6716f317c7fa0901f5bc
Phase 4 branch: refactor/note-agent-parts-actions
preserved unrelated untracked files: next, pnpm
```

Phase 4는 Phase 1~3을 대체하지 않는다. 아래 표는 새 파일을 추가하기 전에 실제
production composition과 타입을 추적한 결과다.

## Current Architecture Mapping

| 현재 역할 | 실제 파일 / 타입 / 서비스 |
| --- | --- |
| Voice entry | `integration/direct-command-voice-turn-bridge.ts`의 `CompletedVoiceTurnRoute`; `integration/browser-direct-command-composition.ts`가 route owner를 한 개 선택 |
| Decision context builder | `application/direct-command-context-builder.ts`; Note input projection은 `runtime/note-agent-shadow-route.ts`의 `buildDecisionInput` |
| Decision provider | `decision/NoteDecisionProvider`, `HttpNoteDecisionProvider`, `LlmNoteDecisionProvider`; 기존 `DirectTextModelTransport`와 same-origin `/api/voice/note-decision` 재사용 |
| Decision schema | `domain/note-agent-types.ts`, `domain/note-agent-schema.ts`의 strict `NoteDecision` / `EntitySelector` / `Destination` parser |
| Tool/Action registry | `tools/note-tool-registry.ts`의 `NoteToolRegistry` |
| Tool definition | `NoteTool`, `NoteSchema`, `NoteToolContext` |
| Tool execution | `tools/existing-tool-adapters.ts`, `math-tools.ts`; 현재 `execute`가 resolve/compute/placement 후 compiled compatibility data를 반환 |
| World resolution | `world/ExistingWorldResolver`; Phase 1 world/index와 Stage 3.5 `FrozenTargetResolver`를 adapter로 재사용 |
| Placement | `runtime/ExistingPlacementEngine`; Stage 4 profile/measurement/candidate gate를 재사용 |
| Compute | `tools/math-tools.ts`의 pure `addFiniteNumbers`, `multiplyNumericMatrices` |
| Editor operation compilation | `integration/editor-note-agent-transaction.ts`가 `DirectEditorCommand` compatibility input을 만들고 기존 direct/spatial compiler로 전달 |
| Transaction owner | `runtime/NoteRuntime`이 모든 successful tool output 뒤 `NoteTransactionPort.commit`을 한 번 호출; 실제 port는 `EditorNoteAgentTransaction` |
| Undo owner | `packages/editor-core`의 `EditorEngine` / `CommandManager` |
| Ambiguity path | `NoteAgentProductionRoute`가 실제 `C1..C6` world 후보에서만 같은 provider를 최대 한 번 호출 |
| Visual fallback | 기존 `SpatialPlacementExecutionPipeline`의 `BoundedMultimodalPlacementResolver`; deterministic ambiguity에서만 screenshot/VLM/preview/final guard 수행 |
| Latency trace | `runtime/note-agent-trace.ts`, `note-runtime-metrics.ts`, `note-agent-latency.ts` |

## Consolidation Constraints

- `SceneObject`, `ExistingUnifiedObjectWorld`, `RebuildableObjectIndex`,
  `DirectCommandOperationLedgerAdapter`를 그대로 source/read boundary로 유지한다.
- `NoteTool`/`NoteToolRegistry` 이름은 저장소 관례와 맞으므로 유지하되, mutation 권한이
  없는 `prepare` 계약으로 책임을 명확히 한다.
- Stage 3.5 exact/fuzzy/semantic resolver와 Stage 4 candidate/VLM/preview/final guard를
  복사하지 않는다.
- production default는 Phase 3 cutover gate가 닫히지 않았으므로 이 Phase에서 몰래
  바꾸지 않는다. explicit `NEXT_PUBLIC_NOTE_AGENT_ROUTE=production`의 구조만 정돈한다.
- persistent commit은 기존 EditorEngine/CommandManager/Operation event/persistence/Undo
  경로 안에서만 수행한다.

## Phase 4 Target Flow

```text
CompletedVoiceTurn
→ ContextAssembler (request-local Prompt Parts / handles)
→ One Note Decision
→ Registered NoteTool.prepare()
→ Prepared Batch validation
→ EditorNoteAgentTransaction.commit() once
→ EditorEngine / CommandManager / Operation event / Undo
```

## Implemented Prompt Parts

`NoteContextAssembler`가 한 request에서 provider를 priority 순으로 한 번씩 collect한다.

| Part | 정책 |
| --- | --- |
| `user-turn` | turn ID, language, NFC + trim만 적용한 final transcript |
| `frozen-context` | document/page/revision/mode와 optional viewport handle |
| `selection-focus` | `SceneObject`에서 만든 compact summary와 request-local handle |
| `recent-operations` | 기존 OperationLedger의 최근 output 최대 3개 |
| `object-detail` | selection/focus 내부 part가 필요한 요청에서만 생성 |
| `candidates` | 실제 ambiguity 후보 최대 6개에서만 생성 |
| `screenshot-crop` | Stage 4 visual fallback용 descriptor; 정상 Decision input에서는 제외 |

순서는 priority와 part ID로 deterministic하다. enabled action schema와 part를 합쳐 기본
2,400 token estimate budget을 적용한다. full Scene/PDF/history를 materialize하지 않으며,
`ObjectHandle`의 실제 `EntityRef`는 `NoteObjectHandleMap` 안에서만 유지한다. persistent
object/part ID는 `ObjectSummary`/`ObjectDetail`/Decision input에 넣지 않는다.

보안 경계상 새 object-detail/candidate/screenshot 본문을 일반 Decision HTTP payload나 trace에
추가하지 않았다. 기존 provider가 이미 받던 selection/focus/recent compact summary는 Part에서
생성한다. candidate-only second pass는 기존 bounded schema를 사용하고, 실제 screenshot crop은
기존 Stage 4 `MultimodalPlacementObservationBuilder`만 소유한다.

## Registered Action / Prepare Contract

저장소의 `NoteTool` 이름을 유지하고 다음 책임으로 정리했다.

```text
strict input parse
→ NoteTool.prepare(input, context without transaction authority)
→ READY(value, PreparedNoteOperation[]) or typed no-commit result
→ NoteRuntime validates all steps
→ NoteTransactionPort.commit once
```

- 모든 등록 Action은 description, examples, strict input/output schema를 갖는다.
- `AllEnabledActionsLoader`가 현재 context에서 enabled인 action schema를 한 번 load한다.
- mutation Action의 `prepare`에는 `transaction`이 전달되지 않는다.
- QUERY/COMPUTE는 operation이 없어야 하고 MUTATION은 최소 한 prepared operation을 가져야 한다.
- batch는 최대 4 step이며 earlier-step output reference만 허용한다. forward/circular reference는
  strict Decision parser가 거부한다.
- 두 번째 prepare 실패, ambiguity, not-found, stale, invalid input/output은 commit 호출 0이다.

현재 enabled action은 `text.create`, `text.replace`, `annotation.apply`,
`navigation.next_page`, `navigation.previous_page`, `history.undo`, `math.add`,
`math.matrix_multiply`다. `graph.add_tangent`, `table.update_cell`은 strict unavailable contract이며
enabled schema에는 나타나지 않는다. object move/delete/style과 math.create는 compiler 부재로
추가하지 않았다.

## Central Atomic Commit

direct annotation mutation batch는 각 prepared operation을 기존
`compileDirectCommandCapability`로 compile한 뒤 `CompositeEditorCommand` 하나로 실행한다.
`CommandManager`에는 한 entry만 생기고 `EditorEngine`은 `BATCH` operation event를 한 번
publish한다. child command 실행 또는 operation materialization이 실패하면 완료된 child를
역순 undo하고 undo stack에는 넣지 않는다.

현재 실제 보장:

- 같은 page의 direct text/annotation mutation batch: transaction 1, operation event 1, undo 1
- compute + direct mutation batch: compute side effect 0, mutation만 중앙 commit
- navigation/undo가 mutation과 섞인 batch: commit 전 explicit unsupported
- spatial mutation이 다른 mutation과 섞인 batch: commit 전 explicit unsupported

마지막 두 경우는 부분 commit 대신 no-commit을 선택한다. cross-page transaction과 mixed
control/spatial transaction을 지원하는 Editor primitive가 생길 때까지 제한으로 남긴다.

## Stage 4 Side-effect-free Preparation

기존 `SpatialPlacementExecutionPipeline`을 다시 구현하지 않고 coordinator를 두 단계로 노출했다.

```text
preparePlacement
  existing candidate generation
  → deterministic gate
  → bounded VLM 0/1
  → Ghost Preview / validation
  → PreparedSpatialPlacement (persistent mutation 0)

executePrepared
  final scene/identity guard
  → existing validated spatial executor
  → Editor commit once
```

새 Note production path는 `Destination | null`의 structured JSON만 visual instruction으로 넘긴다.
raw transcript를 Stage 4에서 다시 의미 해석하지 않는다. `BESIDE`의 좌/우가 동률일 때 한쪽을
임의 선택하지 않으며 ambiguity/no-commit으로 유지한다. legacy compatibility route는 기존
`execute()` API를 계속 사용할 수 있다.

## Diagnostics and Verification

Trace는 기존 필드를 유지하면서 `contextAssemblyMs`, `decisionCallCount`, `prepareMs`,
`worldResolveMs`, `visualFallbackMs`, `visualCallCount`, `renderMs`,
`usedAmbiguityPass`, `usedVisualFallback`을 추가한다. raw document body와 screenshot payload는
기록하지 않는다. `renderMs`는 현재 Editor subscriber 뒤의 별도 paint completion을 관측할 수
없어 route trace에서 0이며, `endToVisibleMs`도 route completion proxy다.

최종 검증 결과:

```text
Web full: 137 files / 964 tests PASS
Editor Core full: 7 files / 54 tests PASS
Web strict typecheck: PASS
Editor Core strict typecheck: PASS
Web targeted lint: PASS
Editor Core targeted lint: PASS (existing config warnings only)
git diff --check: PASS
```

Node `>=22`가 repository requirement이지만 실행 환경은 Node `20.19.4`, pnpm `10.9.0`이었다.
engine warning, expected invalid-provider stderr, jsdom canvas stderr는 기존 known output이며 test
failure가 아니다. 실제 OpenAI/network 및 microphone/browser smoke는 실행하지 않았으므로
운영 p50/p90/p95는 측정하지 않았다.

## Compatibility / Removal Conditions

| Adapter/code | 현재 호출자 | 유지 이유 | 제거 조건 | production commit 권한 |
| --- | --- | --- | --- | --- |
| legacy Direct/Spatial route | default browser composition | rollback 및 real parity gate | live parity + rollback 관찰 | default에서 있음 |
| `buildDecisionInput` | Phase 2 compatibility/tests | 기존 fixture API | shadow fixture migration | 없음 |
| `DirectEditorCommand` compatibility compile | `EditorNoteAgentTransaction` | stable existing editor compiler 재사용 | generic editor operation compiler parity | transaction 내부만 |
| natural placement normalizer | legacy route | default rollback route 의미 계층 | production default 전환 후 제거 | 새 Note path에서는 없음 |
| `SpatialPlacementExecutionPipeline.execute` | legacy route | 기존 Stage 4 compatibility | 모든 caller가 prepare/executePrepared로 이동 | legacy route에서 있음 |

Phase 4는 explicit `NEXT_PUBLIC_NOTE_AGENT_ROUTE=production` 경로를 consolidation했으며 Phase 3의
real-model parity gate를 근거 없이 닫거나 default flag를 바꾸지 않았다.
