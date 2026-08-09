# Stage 3 — Direct Command Route: STATUS

## 1. 현재 상태

```text
Stage: 3 — Direct Command Route
Status: PHASE C COMPLETE
Current Milestone: Phase D — Capability Compile / Editor Runtime Integration
```

Phase A의 strict planner contract와 Phase B의 frozen grounding/guard 위에
Single Text Planner, resolver `AMBIGUOUS` 전용 candidate-only Text
Disambiguator, no-mutation planning pipeline을 연결했다.

```text
CompletedVoiceTurn
→ DirectCommandContextBuilder
→ bounded Frozen Planner Context
→ Single Text Planner
→ strict DirectPlannerResult
→ FrozenTargetResolver
   ├─ RESOLVED
   ├─ AMBIGUOUS → candidate-only Text Disambiguator
   └─ NOT_FOUND
→ DirectCommandGuard
→ READY_FOR_EXECUTION
```

Phase D의 Capability Compiler와 Editor mutation은 시작하지 않았다.
Screenshot, VLM, spatial placement도 구현하지 않았다.

---

## 2. Branch / Commits

```text
branch: feat/stage-3-direct-command-route
base: e9f62e3

Phase A implementation: 82998f0
Phase A docs: 41f2b88

Phase B implementation: 9e014cb
Grounding Architecture docs preservation: cded9af
Phase B docs: 568f083

Phase C start HEAD: 568f083
Phase C planner + disambiguation + pipeline: bd543b9
Phase C docs: this STATUS/CHECKLIST update commit
```

구현 규모상 planner와 disambiguation/pipeline은 하나의 implementation
commit으로 묶었다.

---

## 3. Phase C AI / Server Boundary

브라우저 경계:

```text
Browser/Application
→ same-origin Route Handler
→ server-only configuration/service
→ OpenAI Responses API
```

Route Handler:

- `apps/web/src/app/api/voice/direct-command/planner/route.ts`
- `apps/web/src/app/api/voice/direct-command/disambiguate/route.ts`

Server provider:

- `features/voice/server/direct-command-ai-server.ts`
- `features/voice/server/openai-responses-direct-text-transport.ts`
- `features/voice/server/direct-ai-route-response.ts`

Browser provider:

- `features/voice/providers/http-direct-command-planner-provider.ts`
- `features/voice/providers/http-direct-target-disambiguator-provider.ts`
- `features/voice/providers/http-direct-ai-client.ts`

실제 LLM adapter:

- `LlmDirectCommandPlannerProvider`
- `LlmDirectTargetDisambiguatorProvider`
- vendor-neutral `DirectTextModelTransport`

설정:

```text
OPENAI_API_KEY                 required, server only
DIRECT_COMMAND_MODEL           required, server only
DIRECT_COMMAND_AI_TIMEOUT_MS   optional, default 15000
```

`NEXT_PUBLIC_*` secret은 사용하지 않는다. Model/API key/vendor request는
domain과 application contract에 포함되지 않는다. 서버는 Responses API에
`store: false`와 JSON object output을 요청하고, 최종 신뢰 경계는 기존
strict `DirectPlannerResult` parser로 유지한다.

현재 환경에는 `OPENAI_API_KEY`와 `DIRECT_COMMAND_MODEL`이 없어 실제
network smoke test는 실행하지 않았다. 설정 부재는
`PLANNER_UNAVAILABLE / MISSING_CONFIGURATION`으로 정규화한다.

---

## 4. Single Text Planner

입력:

- raw final transcript를 변형 없이 보존한 `CompletedVoiceTurn`
- frozen page/mode/revision/focus metadata
- bounded planner document context
- bounded recent operation summary
- Stage 3 allowed direct commands

Planner에 보내지 않는 정보:

```text
PageTargetCatalog raw dump
candidateId
sceneObjectId
operationId
focus bounds
screenshot
전체 PDF
```

Prompt policy는 다음 블록을 논리적으로 분리한다.

```text
SYSTEM POLICY
ALLOWED COMMAND SCHEMA
REQUEST AUTHORITY
USER UTTERANCE
FROZEN CONTEXT
UNTRUSTED DOCUMENT CONTEXT
RECENT OPERATION CONTEXT
OUTPUT CONTRACT
```

최초 Planner 한 번에서 filler/self-correction 해석, normalized intent,
`CommandRelation`, command/payload, `TargetQuery`를 함께 생성한다.
별도 STT Refiner API는 없다.

지원 command:

```text
annotation.underline
annotation.highlight
navigation.next_page
navigation.previous_page
history.undo
text.replace_content
```

지원 TargetQuery:

```text
text_span
semantic_unit
object
relative
subrange
```

Prompt는 다음 정책을 포함한다.

- 마지막 자기 정정을 최종 명령으로 해석한다.
- “방금 거 취소”는 이미 commit된 작업에 대한 `history.undo`다.
- 현재 발화의 명령 철회만 semantic `CANCEL`이다.
- recent yellow highlight 수정은 `REVISE_LAST`와 `last_target`으로 표현한다.
- 새 object placement가 필요하면 `DEFER_SPATIAL`이다.
- object/candidate/annotation ID, text offset, 좌표/크기는 생성하지 않는다.

응답 처리는 JSON object 또는 단일 fenced JSON object만 추출한다.
empty/malformed/prose 응답과 unknown field/capability/operation, invalid
payload/query, ID/coordinate injection은 자동 수리하지 않고
`PLANNER_INVALID_OUTPUT`으로 거절한다.

오류:

```text
PLANNER_UNAVAILABLE
PLANNER_TIMEOUT
PLANNER_INVALID_OUTPUT
ABORTED
```

HTTP/network, configuration, timeout, abort, invalid model output을 구분하며
provider-specific 오류 본문은 application/domain 밖으로 노출하지 않는다.
`AbortSignal`은 실제 fetch까지 전달되고 abort 뒤 늦은 응답은 결과로
승격하지 않는다.

---

## 5. Candidate-only Text Disambiguator

호출 조건:

```text
FrozenTargetResolver.status === AMBIGUOUS
```

`RESOLVED`, `NOT_FOUND`, `DEFER_SPATIAL`에서는 호출하지 않는다.

입력은 resolver가 반환한 최대 4개 bounded candidate의 안전한
type/text/source/semantic summary다. Application layer가 내부 후보를
`C1..C4`에 매핑하며 LLM에는 candidateId, sceneObjectId, objectId를
보내지 않는다.

허용 출력:

```text
SELECTED: C1 | C2 | C3 | C4
NONE
```

실제 후보 수보다 큰 label, object ID, 좌표, prose, 새 target/operation
제안은 strict parser에서 거절한다. `NONE`은 `TARGET_AMBIGUOUS` no-commit
결과로 끝나며 임의 top1 fallback은 없다.

구현:

- `direct-target-disambiguator-provider.ts`
- `llm-direct-target-disambiguator-provider.ts`
- `direct-target-disambiguator-prompt.ts`
- `direct-target-disambiguation-context.ts`
- `fake-direct-target-disambiguator-provider.ts`

---

## 6. Planning Pipeline

`DirectCommandPlanningPipeline`은 다음 흐름만 담당한다.

```text
Context build
→ Planner
→ Resolver
→ optional Disambiguator
→ Guard
→ READY_FOR_EXECUTION
```

결과:

- guard 통과: `READY_FOR_EXECUTION`
- resolver not found: `TARGET_NOT_FOUND`
- ambiguous + NONE: `TARGET_AMBIGUOUS`
- spatial plan: `DEFERRED_SPATIAL`
- context/guard/provider failure: typed no-commit error

`READY_FOR_EXECUTION`은 validated command plan, resolved target 또는
control target, frozen context를 전달하는 Phase D 직전 경계다.
EditorEngine, CommandManager, navigation, undo, CanvasObjectStore는 호출하지
않는다.

Lifecycle timestamp:

```text
routeReceivedAt
plannerRequestedAt
plannerCompletedAt
resolverStartedAt
resolverCompletedAt
disambiguatorRequestedAt?
disambiguatorCompletedAt?
validatedAt
```

시간은 주입된 `InteractionClock`을 사용한다. 최종 metric 집계와 logging은
Phase F 범위로 남겼다.

---

## 7. Validation

```text
Phase C targeted:
  6 files / 44 tests PASS

Voice feature:
  38 files / 235 tests PASS

Web regression:
  69 files / 495 tests PASS

Editor Core regression:
  6 files / 47 tests PASS

Web typecheck:
  PASS

Editor Core typecheck:
  PASS

Voice + Route targeted ESLint:
  PASS

Web package lint:
  PASS

git diff --check:
  PASS
```

검증 범위:

- focused/text-span/semantic/editable replace/navigation/undo/self-correction
- `REVISE_LAST`, semantic `CANCEL`, `DEFER_SPATIAL`
- malformed/fenced/empty/prose model output
- unknown command/query, objectId/candidateId/coordinate injection
- valid/HTTP/network/timeout/pre-abort/in-flight abort transport
- candidate C1 selection/internal mapping, NONE, out-of-range/invalid output
- P1–P6 planning pipeline, PDF replace guard, editable text replace guard
- disambiguator가 RESOLVED/NOT_FOUND에서 호출되지 않음
- 실제 외부 network 호출 없이 mock transport 사용

Environment:

- repository requires Node `>=22`
- validation runtime: Node `20.19.4`, pnpm `10.9.0`
- Web regression의 기존 jsdom canvas `getContext` stderr가 출력됐으나
  테스트는 PASS
- 자동 테스트 failure 없음

---

## 8. Current Limitations

Phase B에서 확인한 제한을 그대로 유지한다.

- historical `SceneSnapshot` store가 없다. current snapshot이 frozen
  page/revision과 exact match하지 않으면 `STALE_SCENE`이다.
- exact text offset을 합성하지 않는다. 실제 sentence/paragraph/line/word
  candidate를 resolve하며 synthetic offset/multi-fragment bounds는 없다.
- sentence candidate는 optional `PageSemanticModel`이 있을 때만 제공된다.
- `SubrangeTargetQuery`는 contract만 있고 resolver는
  `SUBRANGE_UNSUPPORTED`다.
- `ResolvedMathSpan`, math subrange, Ink recognition은 지원하지 않는다.
- semantic/math similarity adapter가 없어 해당 evidence는
  `null / unavailable`이다.
- production voice adapter의 graph/math composition은 없다.
- last successful direct operation persistence/idempotency는 Phase E 범위다.
- clarification UI와 Text Disambiguator 이후 대화 재개는 구현하지 않는다.

Phase C는 위 제한을 가짜 offset, embedding, math/ink model로 우회하지 않는다.

---

## 9. Stage 3 Boundary

```text
별도 STT Refiner: 없음
최초 Planner: refine + intent + relation + command + TargetQuery 단일 호출
Planner objectId/candidateId/좌표 권한: 없음
Text Disambiguator: resolver AMBIGUOUS의 bounded candidate 선택 전용
VLM/Screenshot/Placement: 없음
Editor mutation/Capability Compiler: 시작하지 않음
Stage 2 Voice Turn/Voice Lens 변경: 없음
```

---

## 10. 다음 Milestone

```text
Phase D — Capability Compile / Editor Runtime Integration

Resolved CommandPlan
+ ResolvedTarget
+ Guard PASS
→ existing Editor capability
→ CommandManager / Operation Log
→ actual mutation
```

PDF 원문 read-only 정책, 기존 Editor Runtime/Undo 경계, no-commit-on-compile
failure를 유지한다.
