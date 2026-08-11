# Stage 3 — Direct Command Route: STATUS

## 1. 현재 상태

```text
Stage: 3 — Direct Command Route
Status: COMPLETE
Current Milestone: COMPLETE / READY FOR STAGE 4
```

Stage 2 production completion 경계에 Direct Command Route를 자동 연결하고,
shared-clock diagnostics와 bounded structural trace를 추가했다.

```text
CompletedVoiceTurn
→ production completion bridge
→ DirectCommandRoute
→ Planner / Resolver / Guard
→ existing Editor executor / CommandManager
→ actual mutation / navigation / undo
```

Interim transcript와 cancelled/no-speech turn은 Stage 3를 호출하지 않는다.
Stage 4 spatial placement 구현은 시작하지 않았다.

---

## 2. Branch / Commits

```text
branch: feat/stage-3-direct-command-route
base: e9f62e3

Phase F start HEAD: 8120184
Phase F diagnostics/test: 29f9cd6
Phase F production wiring: 40d4e9b
Phase F docs: this STATUS/CHECKLIST update commit
```

---

## 3. Production Wiring

- `VoiceTurnController`의 completed state/result가 확정되는 경계에
  `DirectCommandVoiceTurnBridge`를 연결했다.
- `BrowserDirectCommandComposition`이 shared `InteractionClock`, Voice
  controller, Planner/Disambiguator, Context Builder, Resolver, Guard, Executor,
  DirectCommandRoute를 editor/voice session 동안 한 번 소유한다.
- `DocumentWorkspace`는 기존 Voice trigger/Lens를 유지하며 새 production UI는 없다.
- 10개 interim + 1 completed turn에서 route/Planner는 정확히 한 번 호출된다.
- no-speech/cancel은 route를 호출하지 않는다.
- duplicate completed event는 bridge guard와 route idempotency를 거쳐 mutation
  exactly once를 유지한다.
- unmount/dispose는 subscription과 in-flight AbortSignal을 정리하며 late result는
  mutation으로 승격하지 않는다.
- route failure 후 다음 completed turn은 정상 처리된다.

---

## 4. Diagnostics

- `direct-command-diagnostics-types.ts`
- `direct-command-diagnostics.ts`
- 하나의 injected `InteractionClock`으로 Stage 2 voice finalized와 Stage 3
  route/planner/resolver/disambiguator/validation/compile/commit을 측정한다.
- 제공 metric:
  - `plannerMs`
  - `resolverMs`
  - `disambiguatorMs` (미호출 시 없음)
  - `validationMs`
  - `compileMs`
  - `commitMs`
  - `directRouteMs`
  - `voiceEndToCommitMs`
- trace는 최대 64개 bounded session memory다.
- trace에는 turn/plan/operation ID, command/relation, target query/resolution,
  guard/execution/error 상태와 latency만 둔다.
- raw transcript, 전체 PDF/document text, prompt, raw model response, API key는
  저장하지 않는다.
- observer/storage failure는 실행 결과나 mutation을 바꾸지 않는다.

---

## 5. Final E2E / Safety

- actual production boundary E2E에서 focused PDF underline이 Editable Layer에
  생성되고 PDF source는 불변이며 Operation Log/trace가 한 번 기록된다.
- text-span은 synthetic offset 없이 실제 semantic candidate 최소 bounds를 쓴다.
- highlight, self-correction highlight-only, highlight color REVISE_LAST,
  same-target CONTINUE, editable text replace와 undo가 통과한다.
- PDF replace는 guard/executor에서 차단되고 source/operation log가 변하지 않는다.
- next/previous page는 DocumentSession semantics를 사용하며 Editor undo history에
  포함하지 않는다.
- history.undo는 기존 EditorEngine/CommandManager inverse를 사용한다.
- ambiguous C2 선택과 NONE no-commit, spatial defer, stale scene no-commit,
  invalid planner output no-commit이 통과한다.
- 순차/동시 duplicate는 operation exactly once다.
- Planner timeout 뒤 다음 turn 복구와 in-flight dispose no-commit이 통과한다.
- LLM이 objectId/candidateId/coordinate를 생성할 수 없는 strict parser
  regression을 유지한다.

---

## 6. Actual LLM Smoke

- `OPENAI_API_KEY` 설정 여부: configured
- 실제 key 값은 읽거나 기록하지 않았다.
- 외부 API에 한국어 발화/document payload를 전송할 승인이 없어 actual network
  smoke는 `SKIPPED`로 기록한다. Stage 3 failure가 아니다.
- mock transport/provider와 strict runtime parser 기반 Planner/Disambiguator
  테스트는 모두 PASS다.
- actual API latency sample은 없다.

---

## 7. Validation

```text
Phase F targeted:
  6 files / 44 tests PASS

Production lifecycle/Strict Mode subset:
  5 files / 26 tests PASS

Voice feature:
  47 files / 289 tests PASS

Web regression:
  78 files / 549 tests PASS

Editor Core regression:
  6 files / 47 tests PASS

Web typecheck:
  PASS

Editor Core typecheck:
  PASS

Phase F targeted ESLint:
  PASS

Web package lint:
  PASS

Editor Core package lint:
  PASS

git diff --check:
  PASS
```

검증 범위는 production completion bridge, shared composition lifecycle,
instrumentation duration 계산, bounded/redacted trace, dispose safety와 Phase A-E
Voice/Planner/Resolver/Guard/Executor/History/Idempotency regression을 포함한다.

Environment:

- repository requires Node `>=22`
- validation runtime: Node `20.19.4`, pnpm `10.9.0`
- 기존 jsdom canvas `getContext` stderr가 Web regression에서 출력됐으나
  테스트는 PASS
- Editor Core lint의 기존 React detect/pages-directory warning이
  출력됐으나 lint는 PASS
- 자동 테스트 failure 없음

---

## 8. Current Limitations

- historical `SceneSnapshot` store가 없다. 현재 frozen snapshot을
  재구성할 수 없으면 `STALE_SCENE`이다.
- exact arbitrary text offset을 합성하지 않는다. 실제 semantic candidate의
  최소 bounds만 사용한다.
- Editor annotation model은 single rect다. Multi-rect target은
  `COMPILE_FAILED`다.
- PDF semantic source object/range anchor는 annotation serialization에
  영속화되지 않는다.
- `SubrangeTargetQuery`, `ResolvedMathSpan`, math subrange, Ink
  recognition은 지원하지 않는다.
- semantic/math similarity adapter는 unavailable이다.
- REVISE_LAST는 highlight color와 editable text content로 제한된다.
- EditorOperation 자체에 `sourceTurnId` metadata는 없다.
- Direct operation/history/idempotency와 trace는 현재 app/session memory
  범위다. refresh 이후 복원 persistence는 없다.
- commit API가 operation event 전에 mutation하고 예외를 내는 비표준
  adapter에서는 성공 여부를 완전히 증명할 수 없다. 따라서
  `COMMIT_FAILED` turn은 자동 retry하지 않는다.
- actual OpenAI smoke는 외부 payload 전송 승인 없이 수행하지 않았다.

---

## 9. Stage 3 Boundary

```text
Production automatic execution: 연결 완료
Phase F diagnostics/regression: 완료
새 capability: 없음
LLM provider/model 변경: 없음
VLM/Screenshot/Spatial Placement: 없음
새 Undo Stack/Editor Runtime: 없음
Voice Turn/Voice Lens 대규모 변경: 없음
Stage 4 implementation: 시작하지 않음
```

---

## 10. Stage 4 Handoff

```text
DEFER_SPATIAL
→ original CompletedVoiceTurn
→ Frozen Context
→ spatial defer reason
→ normalized intent / command summary
```

Stage 4가 추가할 정보:

- Structured Scene
- Render Snapshot
- Focus Crop
- Occupancy / Free-space Candidates
- Multimodal Planner
- Placement Candidate
- Deterministic Placement

Screenshot, VLM, free-space search, placement 구현은 시작하지 않았다.
