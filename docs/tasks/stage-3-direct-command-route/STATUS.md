# Stage 3 — Direct Command Route: STATUS

## 1. 현재 상태

```text
Stage: 3 — Direct Command Route
Status: PHASE E COMPLETE
Current Milestone: Phase F — Diagnostics / Regression / Stage Completion
```

Phase D의 `READY_FOR_EXECUTION → Existing Editor Runtime` 경계 위에
session-scoped history context와 exactly-once route orchestration을 연결했다.

```text
CompletedVoiceTurn
→ DirectCommandRoute
→ in-flight/completed turn registry
→ planning + frozen last-target grounding
→ NEW | REVISE_LAST | CONTINUE
→ existing Editor executor
→ successful operation context update
```

Phase F diagnostics, final E2E, production automatic Voice wiring은 시작하지
않았다.

---

## 2. Branch / Commits

```text
branch: feat/stage-3-direct-command-route
base: e9f62e3

Phase E start HEAD: 3017a0f
Phase E history/relation: bb4371c
Phase E route/idempotency: cace053
Phase E docs: this STATUS/CHECKLIST update commit
```

---

## 3. Operation / History 조사

- `EditorOperation`은 operation ID, type, annotation ID, before/after payload,
  timestamp를 보존한다.
- `CommandManager`는 execute마다 한 command를 undo stack에 넣고
  `UpdateAnnotationCommand`는 before/after snapshot으로 undo한다.
- `EditorEngine.subscribeToOperations()`의 synchronous execute/undo event에서
  operation ID와 annotation ID를 확인한다.
- EditorOperation schema에 Voice 전용 `sourceTurnId`를 추가하지 않았다.
  application record가 `turnId ↔ planId ↔ operationId`를 연결한다.
- 새 Voice undo stack이나 Editor history 복제는 없다.

---

## 4. Phase E 구현

History context:

- `features/voice/domain/direct-command-history-types.ts`
- `features/voice/application/direct-command-history-context.ts`
- 최대 32개의 successful Direct Operation record를 session memory에 보존한다.
- `lastSuccessfulOperation`과 `lastReusableTarget`을 분리한다.
- Navigation/Undo는 last successful operation을 갱신하지만 reusable content
  target은 덮어쓰지 않는다.
- Planner에는 command와 bounded target summary만 전달하며 candidate ID,
  scene object ID, annotation ID는 노출하지 않는다.

LAST_TARGET:

- `DirectCommandContextBuilder`가 route history snapshot을 planner/resolver
  context에 전달한다.
- `FrozenTargetResolver`는 저장 candidate ID/source/type/object identity를
  현재 frozen catalog에서 exact match로 재검증한다.
- 동일 text라는 이유로 다른 candidate에 silent retarget하지 않는다.
- 이전 page이거나 candidate가 사라졌으면 no mutation이다.

REVISE_LAST:

- 최초 Planner의 full replacement plan을 사용한다.
- 지원 범위:
  - `annotation.highlight`의 명시적 color 변경
  - Ggulnote editable `text.replace_content`
- Highlight는 기존 annotation ID에 `UpdateAnnotationCommand`를 실행한다.
  새 highlight를 추가하거나 undo+create 중간 상태를 만들지 않는다.
- Editable text도 기존 update command를 재사용한다.
- Underline style 등 현재 capability가 없는 revise는
  `REVISE_NOT_AVAILABLE`이다.

CONTINUE:

- exact-valid lastReusableTarget을 새 command에 연결한다.
- Executor에는 relation을 `NEW`로 정규화한 deterministic add command만
  전달하고 history record에는 원래 `CONTINUE` relation을 보존한다.
- Highlight 뒤 underline은 별도 Editor operation/undo unit이다.

Route / idempotency:

- `features/voice/application/direct-command-route.ts`
- `features/voice/application/direct-command-execution-registry.ts`
- 동일 in-flight turn은 하나의 Promise를 공유해 planner와 commit을 한 번만
  수행한다.
- 성공/결정적 terminal result는 최대 128 turn bounded cache에서 replay한다.
- `PLANNER_ERROR`, `PLANNER_UNAVAILABLE`, `PLANNER_TIMEOUT`, `ABORTED`는
  retry 가능하며 in-flight entry를 항상 정리한다.
- `COMMIT_FAILED`는 side effect 불확실성 때문에 consumed로 보존해 동일
  turn 자동 재시도로 인한 중복 mutation을 막는다.
- failed/deferred/ambiguous/cancelled result는 successful history context를
  변경하지 않는다.

---

## 5. Undo / Context 정책

- Highlight color revise 후 undo 한 번은 이전 color를 복원한다.
- Editable text revise 후 undo 한 번은 직전 replacement text를 복원한다.
- CONTINUE underline 후 undo 한 번은 underline만 제거하고 이전 highlight는
  유지한다.
- Undo 성공은 last successful operation이 되어 제거된 mutation을
  REVISE_LAST 대상으로 남기지 않는다.
- PDF annotation undo 뒤 underlying PDF target identity가 current frozen
  catalog에 계속 존재하면 reusable target은 유지할 수 있다.
- Editable target이 삭제됐으면 reuse 시 `INVALID_TARGET`으로 no mutation
  처리한다.

---

## 6. Production Wiring

- Public application API:
  - `DirectCommandRoute.execute(CompletedVoiceTurn)`
  - `getLastOperation()`
  - `getLastReusableTarget()`
  - `dispose()`
- Route/controller는 UI와 독립적이며 Phase C planning과 Phase D executor를
  structural ports로 조합한다.
- 기존 production Voice UI에서 CompletedVoiceTurn을 자동으로 route에
  전달하는 wiring은 아직 없다.
- Voice Lens/Voice Turn state machine/UI 변경은 없다.

---

## 7. Validation

```text
Phase E targeted:
  7 files / 55 tests PASS

Voice feature:
  43 files / 279 tests PASS

Web regression:
  74 files / 539 tests PASS

Editor Core regression:
  6 files / 47 tests PASS

Web typecheck:
  PASS

Editor Core typecheck:
  PASS

Phase E targeted ESLint:
  PASS

Web package lint:
  PASS

Editor Core package lint:
  PASS

git diff --check:
  PASS
```

검증 범위:

- highlight color / editable text REVISE_LAST + operation log + undo
- CONTINUE same target + independent undo unit
- no previous/invalidated/previous-page target no mutation
- navigation/undo context policy
- deferred/ambiguous/planner error history pollution 방지
- completed/concurrent duplicate exactly once
- transient planner retry와 failure cleanup
- bounded completed registry와 commit uncertainty 정책
- Planner history summary internal ID 미노출
- Phase A-D Voice/Planner/Resolver/Guard/Executor regression

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
- Direct operation/history/idempotency는 현재 app/session memory 범위다.
  refresh 이후 복원 persistence는 없다.
- commit API가 operation event 전에 mutation하고 예외를 내는 비표준
  adapter에서는 성공 여부를 완전히 증명할 수 없다. 따라서
  `COMMIT_FAILED` turn은 자동 retry하지 않는다.
- production Voice UI automatic route wiring은 Phase F final integration에
  남아 있다.

---

## 9. Stage 3 Boundary

```text
새 capability: 없음
LLM provider/model/network 변경: 없음
VLM/Screenshot/Spatial Placement: 없음
새 Undo Stack/Editor Runtime: 없음
Voice Turn/Voice Lens 대규모 변경: 없음
Phase F metrics/diagnostics: 시작하지 않음
```

---

## 10. 다음 Milestone

```text
Phase F — Diagnostics / Regression / Stage 3 Completion

plannerMs
resolverMs
disambiguatorMs
validationMs
compileMs
commitMs
directRouteMs
voiceEndToCommitMs
debug trace
final E2E
production wiring 최종 확인
Stage 4 handoff
```
