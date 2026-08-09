# Stage 3 — Direct Command Route: STATUS

## 1. 현재 상태

```text
Stage: 3 — Direct Command Route
Status: PHASE D COMPLETE
Current Milestone: Phase E — Relation / History Context / Idempotency
```

Phase C의 no-mutation `READY_FOR_EXECUTION` 경계 뒤에 deterministic
Capability Compiler와 기존 Editor/DocumentSession adapter를 연결했다.

```text
READY_FOR_EXECUTION
→ DirectCommandCapabilityCompiler
→ EditorDirectCommandExecutor
→ existing EditorEngine / CommandManager
→ Operation Log / Undo
```

Phase E의 `REVISE_LAST`, `CONTINUE`, last-successful-operation persistence,
turn/in-flight dedupe는 시작하지 않았다.

---

## 2. Branch / Commits

```text
branch: feat/stage-3-direct-command-route
base: e9f62e3

Phase D start HEAD: a7b4f50
Phase D editor-core: e2cfd5b
Phase D voice implementation: 7f1ffe8
Phase D docs: this STATUS/CHECKLIST update commit
```

---

## 3. Existing Runtime 조사

Annotation:

- `packages/editor-core/src/engine/editor-engine.ts`
  - `createAnnotation()`은 `CreateAnnotationCommand`와 `CommandManager`를
    거쳐 `CREATE_ANNOTATION` operation을 발행한다.
  - 한 annotation 생성은 한 undo unit이다.
- `CreateAnnotationInput`은 normalized single rect 기반이다.
- 현재 annotation serialization에는 PDF semantic source object/range
  anchor field가 없고 geometry overlay만 저장한다.

Editable text:

- `EditorEngine.updateSelected()`는 `UpdateAnnotationCommand`를 통해
  `UPDATE_ANNOTATION` operation을 발행하고 before/after snapshot으로
  undo한다.
- `CanvasObjectStore.updateObject()`는 command history 경로가 아니므로
  Direct Executor에서 사용하지 않는다.

Navigation:

- `useDocumentSession().goToPage()`는 `GO_TO_PAGE` reducer action을 사용한다.
- `documentSessionReducer`가 첫/마지막 페이지 clamp를 소유한다.
- Navigation은 Editor content history에 넣지 않는다.

History:

- `EditorEngine.canUndo()`와 `EditorEngine.undo()`를 재사용한다.
- `subscribeToOperations()`의 `execute` / `undo` event와 기존 operation ID를
  실행 결과에 보존한다.

---

## 4. Phase D 구현

Domain / compiler:

- `features/voice/domain/direct-command-execution-types.ts`
- `features/voice/application/direct-command-capability-compiler.ts`

`ReadyForDirectCommandExecution`은 Phase C 결과 중
`status: READY_FOR_EXECUTION`만 추출한다. Compiler 결과는 다음 기존
runtime instruction으로 제한된다.

```text
CREATE_ANNOTATION
REPLACE_TEXT_CONTENT
NAVIGATE
UNDO
```

Runtime adapter:

- `features/voice/integration/editor-direct-command-executor.ts`
- `EditorDirectCommandExecutor`
- `createDocumentSessionDirectCommandNavigationPort`

지원 command:

```text
annotation.underline
annotation.highlight
navigation.next_page
navigation.previous_page
history.undo
text.replace_content
```

Annotation:

- Resolver의 실제 단일 canonical bounds를
  `canonicalToNormalizedRect()`로 변환한다.
- `EditorEngine.createAnnotation()`으로 Editable Layer에 UNDERLINE 또는
  HIGHLIGHT를 생성한다.
- highlight payload color가 없으면 compiler가 color를 넣지 않고
  Editor Core default를 사용한다.
- UI/serializer와 달랐던 generic `AnnotationFactory` highlight default를
  `#facc15`로 정렬했다.
- PDF source object/text는 읽거나 다시 쓰지 않는다.

Editable text:

- resolved canvas scene object ID를 frozen page snapshot의 annotation과
  `editorAnnotationSceneId()`로 deterministic하게 매핑한다.
- TEXT annotation만 `updateSelected()` command path로 content를 교체한다.
- PDF, non-editable, non-text target은 commit 전에 거절한다.

Navigation / History:

- next/previous는 현재 page에 `+1/-1`을 요청하고 기존 DocumentSession
  reducer가 boundary를 결정한다.
- undo는 `canUndo()`가 false면 `UNDO_NOT_AVAILABLE`, 가능하면 기존
  `EditorEngine.undo()`를 호출한다.

Result / trace:

```text
COMMITTED  turnId + planId + operationId
NAVIGATED  turnId + direction
UNDONE     turnId + operationId
ERROR      turnId + normalized errorCode
```

EditorOperation schema에는 Voice 전용 metadata를 추가하지 않았다.
`turnId ↔ operationId`는 execution result에서 추적 가능하며
last-successful-operation persistence는 Phase E에 남겼다.

---

## 5. Execution Safety

- Executor public input은 `READY_FOR_EXECUTION` 전용 type이다.
- annotation/text commit 직전에 frozen scene revision과 active page를
  다시 확인한다.
- target candidate existence/source/type/object mapping을 compiler에서
  다시 검증한다.
- compile failure는 mutation을 만들지 않는다.
- runtime exception/rejected Promise는 `COMMIT_FAILED`로 정규화한다.
- empty undo history는 `UNDO_NOT_AVAILABLE`이다.
- `REVISE_LAST`는 `REVISE_NOT_AVAILABLE`로 no-commit 처리한다.
- `CONTINUE`는 `UNSUPPORTED_RELATION`으로 no-commit 처리한다.
- semantic `CANCEL`은 Phase C terminal result라 Executor에 들어오지 않는다.
- navigation/undo control command에는 target geometry용 execution-time
  scene revision check를 강제하지 않는다.
- 새 Editor Runtime, Voice 전용 Undo Stack, direct Canvas store mutation은
  없다.

---

## 6. Validation

```text
Phase D targeted:
  2 files / 19 tests PASS

Editor Core highlight default targeted:
  1 file / 5 tests PASS

Voice feature:
  40 files / 255 tests PASS

Web regression:
  71 files / 515 tests PASS

Editor Core regression:
  6 files / 47 tests PASS

Web typecheck:
  PASS

Editor Core typecheck:
  PASS

Voice + Editor Core targeted ESLint:
  PASS

Web package lint:
  PASS

Editor Core package lint:
  PASS

git diff --check:
  PASS
```

검증 범위:

- PDF underline/highlight 생성, PDF source immutability, operation log, undo
- highlight explicit/default color
- editable text replace, update operation, undo restore
- PDF text replace defense
- next/previous 및 실제 DocumentSession reducer boundary
- voice undo / empty history
- execution-time stale revision no-commit
- `REVISE_LAST` / `CONTINUE` no-commit
- compile/runtime failure normalization

Environment:

- repository requires Node `>=22`
- validation runtime: Node `20.19.4`, pnpm `10.9.0`
- 기존 jsdom canvas `getContext` stderr가 Web regression에서 출력됐으나
  테스트는 PASS
- Editor Core lint의 기존 React detect/pages-directory warning이
  출력됐으나 lint는 PASS
- 자동 테스트 failure 없음

---

## 7. Current Limitations

- historical `SceneSnapshot` store가 없다. current snapshot이 frozen
  page/revision과 exact match하지 않으면 `STALE_SCENE`이다.
- exact arbitrary text offset을 합성하지 않는다. 실제 semantic candidate의
  최소 bounds만 사용한다.
- Editor annotation model은 single rect다. Multi-rect target을 여러
  operation으로 분해하지 않고 `COMPILE_FAILED`로 거절한다.
- PDF semantic source object/range anchor를 annotation serialization에
  영속화하는 필드가 없다. 현재 overlay는 resolved bounds에 고정된다.
- sentence candidate는 optional `PageSemanticModel`이 있을 때만 제공된다.
- `SubrangeTargetQuery`, `ResolvedMathSpan`, math subrange, Ink recognition은
  지원하지 않는다.
- semantic/math similarity adapter는 `null / unavailable`이다.
- production voice adapter의 graph/math composition은 없다.
- clarification UI와 Text Disambiguator 이후 대화 재개는 구현하지 않았다.
- EditorOperation 자체에 `sourceTurnId` metadata는 없다. execution result가
  `turnId + operationId` correlation을 보존한다.
- production Voice UI 자동 실행 wiring은 Phase D 범위에서 추가하지 않았다.
- last-successful-operation, `REVISE_LAST`, `CONTINUE`, duplicate turn/in-flight
  관리는 Phase E 범위다.

---

## 8. Stage 3 Boundary

```text
Planner/Resolver/Guard 재구현: 없음
LLM prompt/provider/server route 변경: 없음
VLM/Screenshot/Spatial Placement: 없음
새 Undo Stack/Editor Runtime: 없음
Voice Turn/Voice Lens 변경: 없음
Phase E relation persistence/idempotency: 시작하지 않음
```

---

## 9. 다음 Milestone

```text
Phase E — Relation / History Context / Idempotency

REVISE_LAST
CONTINUE
last-successful-operation
LAST_TARGET grounding lifecycle
duplicate turnId 방지
duplicate in-flight 방지
failed/deferred/ambiguous turn은 history context를 덮어쓰지 않음
```
