# Stage 3 — Direct Command Route: STATUS

## 1. 현재 상태

```text
Stage: 3 — Direct Command Route
Status: PHASE A COMPLETE
Current Milestone: Phase B — Context Builder / Target Resolver / Eligibility Guard
```

Phase A의 Domain / Provider 계약과 Fake Provider, strict runtime validation을 완료했다.
Stage 2 Voice Turn / Voice Lens와 Stage 1 Scene Core는 변경하지 않았다.

---

# 2. Branch

현재 branch:

```text
feat/stage-3-direct-command-route
```

규칙:

- 이미 branch가 존재하면 계속 사용한다.
- 없으면 Stage 2 완료 HEAD에서 생성한다.
- 기존 미커밋 변경이 있으면 보존한다.
- `git reset --hard`, `git clean`, 무단 `git stash` 금지.

기준점:

```text
base: e9f62e3 (Stage 2 merge on develop)
Phase A implementation HEAD: 82998f0
Phase A docs HEAD: this STATUS / CHECKLIST update commit
working tree: clean after docs commit
```

---

# 3. Source of Truth

```text
AGENTS.md
> docs/tasks/stage-3-direct-command-route/DECISIONS.md
> docs/tasks/stage-3-direct-command-route/SPEC.md
> docs/tasks/stage-3-direct-command-route/CHECKLIST.md
> docs/tasks/stage-3-direct-command-route/STATUS.md
```

Stage 2 관련 문서는 dependency 확인용으로 함께 읽었다. 저장소의 실제 파일명은
`STAGE2_DECISIONS.md`, `STAGE2_SPEC.md`, `STAGE2_CHECKLIST.md`,
`STAGE2_STATUS.md`다.

---

# 4. Stage 3 범위 요약

구현:

```text
CompletedVoiceTurn 입력
Direct Planner Provider
Refine + Intent 단일 호출
Strict Direct CommandPlan
Frozen Focus target resolve
Scene Revision validation
Direct capability allowlist
Deterministic compile
Existing Editor Runtime commit
Undo / Revise / Continue
turnId idempotency
Latency diagnostics
```

제외:

```text
Voice Turn 재구현
Voice Lens 재구현
Screenshot / VLM
Spatial Placement
Free-space Candidate
Table / Math / Graph 생성
Gaze targeting
새 production UI
```

---

# 5. 필수 Direct Commands

```text
annotation.underline
annotation.highlight
navigation.next_page
navigation.previous_page
history.undo
text.replace_content   // editable text only
```

---

# 6. Stage 4로 미루는 항목

다음은 의도적으로 Stage 3에서 구현하지 않는다.

```text
"오른쪽 여백에 메모"
"아래 빈 공간에 표"
"수식 아래 그래프"
"내용을 가리지 않게 배치"
```

처리:

```text
DEFER_SPATIAL
→ no commit
```

Stage 4에서 Multimodal Spatial Placement Route가 이어받는다.

---

# 7. Phase 상태

## Phase 0 — Preflight

Status:

```text
COMPLETE
```

기록:

```text
branch: feat/stage-3-direct-command-route
base: e9f62e3
working tree before work: clean
Stage 2 completion: implementation complete; merged by e9f62e3
runtime: Node 20.19.4, pnpm 10.9.0
```

재사용 경계:

- Voice: `apps/web/src/features/voice/domain/voice-turn-types.ts`
  - `CompletedVoiceTurn`, `FrozenVoiceTurnContext`, turn ID, raw transcript
- Scene: `packages/editor-core/src/scene-core/types.ts`,
  `scene-snapshot.ts`, `revision.ts`
  - `SceneSnapshot`, scene revision, `SceneMode`, `Rect`, `objectById`
- Editor: `packages/editor-core/src/engine/editor-engine.ts`,
  `commands/command-manager.ts`, `operations/editor-operation.ts`,
  `scene-core/canvas-object-store.ts`
  - annotation create/update, operation event, undo, editable canvas object update
- Navigation: `apps/web/src/features/document/hooks/use-document-session.ts`
  - `goToPage`
- AI/provider: 기존 OpenAI/LLM provider와 server route/action 없음
- Runtime schema: 직접 사용하는 Zod dependency가 없어 strict 수동 parser 사용

---

## Phase A — Domain / Provider Contracts

Status:

```text
COMPLETE
```

완료 후 기록:

```text
implementation commit: 82998f0
docs commit: this STATUS / CHECKLIST update commit
next milestone: Phase B
```

구현 파일:

- `apps/web/src/features/voice/domain/direct-command-types.ts`
- `apps/web/src/features/voice/domain/direct-planner-schema.ts`
- `apps/web/src/features/voice/providers/direct-command-planner-provider.ts`
- `apps/web/src/features/voice/providers/testing/fake-direct-command-planner-provider.ts`
- 위 계약의 colocated unit tests와 Voice public exports

검증:

- Phase A targeted: 2 files, 10 tests PASS
- Web regression: 58 files, 424 tests PASS
- Editor Core regression: 6 files, 47 tests PASS
- Web typecheck: PASS
- Editor Core typecheck: PASS
- Targeted ESLint / Web package lint: PASS
- `git diff --check`: PASS

Known failure:

- 현재 자동 테스트 실패 없음
- Stage 2 문서의 기존 Raw Gaze 실패는 현재 HEAD에서 재현되지 않음
- 저장소 요구 Node `>=22`와 달리 Node `20.19.4`에서 검증해 engine warning 발생
- Web regression 중 jsdom canvas 미구현 stderr가 출력됐지만 전체 테스트는 PASS

---

## Phase B — Context / Target / Eligibility

Status:

```text
NEXT MILESTONE
```

완료 후 기록:

```text
implementation commit:
docs commit:
tests:
notes:
```

---

## Phase C — Single Text Planner

Status:

```text
PENDING
```

완료 후 기록:

```text
implementation commit:
docs commit:
tests:
provider/model boundary:
notes:
```

---

## Phase D — Editor Runtime Integration

Status:

```text
PENDING
```

완료 후 기록:

```text
implementation commit:
docs commit:
tests:
reused runtime:
notes:
```

---

## Phase E — Relation / History / Idempotency

Status:

```text
PENDING
```

완료 후 기록:

```text
implementation commit:
docs commit:
tests:
notes:
```

---

## Phase F — Diagnostics / Completion

Status:

```text
PENDING
```

완료 후 기록:

```text
implementation commit:
docs commit:
lint:
typecheck:
tests:
git diff --check:
known issues:
deferred to Stage 4:
```

---

# 8. Known Constraints

현재 설계상 고정:

```text
Gaze 미사용
Direct Route에는 이미지 미사용
LLM 좌표 출력 금지
PDF source text는 read-only
Spatial request는 no commit
Planner 결과는 strict validation 필수
```

---

# 9. 완료 시 최종 기록 형식

```text
## Final

branch:
base:
final HEAD:

implementation commits:
- ...

docs commits:
- ...

validation:
- lint:
- typecheck:
- test:
- git diff --check:

E2E:
- underline:
- highlight:
- self correction:
- revise:
- next/previous page:
- undo:
- editable text replace:
- PDF text edit blocked:
- spatial deferred:
- duplicate turn:
- stale scene:

known issues:
- ...

Stage 4 handoff:
- ...
```
