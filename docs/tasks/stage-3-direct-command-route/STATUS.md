# Stage 3 — Direct Command Route: STATUS

## 1. 현재 상태

```text
Stage: 3 — Direct Command Route
Status: PHASE A COMPLETE
Current Milestone: Phase B — Command Context / Frozen Target Grounding / Eligibility Guard
```

Phase A의 Domain / Provider 계약과 Fake Provider, strict runtime validation을 완료했다.

Phase B 시작 시 최종 Grounding Architecture에 맞춰
Phase A의 `DirectTargetRef` 중심 target contract를 최소 범위로 확장한다.

이는 Phase A를 재구현하는 것이 아니라:

```text
FROZEN_FOCUS / LAST_TARGET
→ RelativeTargetQuery

CURRENT_PAGE / LAST_OPERATION
→ control target 유지

+ TextSpan / SemanticUnit / Object / Subrange TargetQuery 추가
```

하는 contract alignment다.

Stage 2 Voice Turn / Voice Lens와 Stage 1 Scene Core는 변경하지 않는다.

---

# 2. Branch

현재 branch:

```text
feat/stage-3-direct-command-route
```

기준점:

```text
base: e9f62e3
Phase A implementation commit: 82998f0
Phase A docs commit: 41f2b88
current HEAD before Phase B: 41f2b88
working tree: clean
```

규칙:

- 현재 branch를 계속 사용한다.
- 기존 미커밋 변경이 있으면 보존한다.
- `git reset --hard`, `git clean`, 무단 `git stash` 금지.

---

# 3. Source of Truth

```text
AGENTS.md
> docs/tasks/stage-3-direct-command-route/DECISIONS.md
> docs/tasks/stage-3-direct-command-route/SPEC.md
> docs/tasks/stage-3-direct-command-route/CHECKLIST.md
> docs/tasks/stage-3-direct-command-route/STATUS.md
```

Stage 2 관련 문서는 dependency 확인용으로 함께 읽는다.

저장소의 실제 Stage 2 파일명:

```text
STAGE2_DECISIONS.md
STAGE2_SPEC.md
STAGE2_CHECKLIST.md
STAGE2_STATUS.md
```

---

# 4. 최종 Stage 3 아키텍처

```text
CompletedVoiceTurn
        ↓
Frozen Context
        ↓
DirectCommandContextBuilder
        ↓
PageTargetCatalog + Recent Operations
        ↓
Text Planner
        ↓
CommandPlan + TargetQuery
        ↓
FrozenTargetResolver
        ↓
ResolvedTarget
        ↓
Guard
        ↓
Capability Compiler
        ↓
Existing Editor Runtime
        ↓
CommandManager / Operation Log
        ↓
Apply / Undo / Redo
```

핵심 권한 분리:

```text
Planner
→ 의미적 TargetQuery만 생성

Resolver
→ 실제 Scene target 결정

Guard
→ PDF read-only / editability / revision 검증

Editor
→ 실제 mutation
```

---

# 5. Scene Permission Model

```text
Page Scene
├─ Base Document Layer
│  └─ PDF / semantic document objects
│     READ ONLY
│
└─ Ggulnote Editable Layer
   └─ annotations / canvas objects
      EDITABLE
```

PDF는 Resolver 검색 대상이지만 원문은 수정하지 않는다.

허용:

```text
PDF TextSpan
→ underline / highlight annotation 생성
```

금지:

```text
PDF source text
→ replace / delete / move
```

---

# 6. Stage 3 범위 요약

구현:

```text
CompletedVoiceTurn 입력
Direct Planner Provider
Refine + Intent + TargetQuery 최초 단일 호출
Strict Direct CommandPlan
PageTargetCatalog
Frozen Target Resolver
Candidate Ranking
ResolvedTarget
Scene Revision validation
PDF read-only guard
Direct capability allowlist
Deterministic compile
Existing Editor Runtime commit
Undo / Revise / Continue
turnId idempotency
Latency diagnostics
```

조건부:

```text
Resolver AMBIGUOUS
→ bounded candidate-only Text Disambiguator
```

제외:

```text
Voice Turn 재구현
Voice Lens 재구현
Screenshot / VLM
Spatial Placement
Free-space Candidate
Table / Math / Graph 생성
새 embedding service
새 Ink/Math recognition
Gaze targeting
새 production UI
```

---

# 7. 필수 Direct Commands

```text
annotation.underline
annotation.highlight
navigation.next_page
navigation.previous_page
history.undo
text.replace_content   // Ggulnote editable text only
```

Target 표현:

```text
annotation/text
→ TargetQuery

navigation
→ CURRENT_PAGE

history.undo
→ LAST_OPERATION
```

---

# 8. Target Grounding Contract

Planner가 생성할 수 있는 TargetQuery:

```text
TextSpanTargetQuery
SemanticUnitTargetQuery
ObjectTargetQuery
RelativeTargetQuery
SubrangeTargetQuery
```

Planner가 생성하면 안 되는 것:

```text
arbitrary objectId
candidateId
x/y coordinate
```

Resolver 결과:

```text
RESOLVED
AMBIGUOUS
NOT_FOUND
```

ResolvedTarget:

```text
ResolvedTextSpan
ResolvedObject
ResolvedMathSpan          // future/available model only
ResolvedObjectSubrange    // future/available model only
```

---

# 9. Stage 4로 미루는 항목

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

# 10. Phase 상태

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
Stage 2 completion: merged by e9f62e3
runtime: Node 20.19.4, pnpm 10.9.0
```

재사용 경계:

- Voice: `apps/web/src/features/voice/domain/voice-turn-types.ts`
  - `CompletedVoiceTurn`, `FrozenVoiceTurnContext`
- Scene: `packages/editor-core/src/scene-core/types.ts`
  - Scene revision / object lookup
- Editor:
  - `CreateAnnotationInput`
  - `EditorEngine.createAnnotation/updateSelected`
  - `CanvasObjectStore.updateObject()`
- Navigation:
  - `useDocumentSession().goToPage`
- History:
  - `EditorEngine.subscribeToOperations()`
  - `EditorEngine.undo()`
  - `CommandManager`
- AI/provider:
  - 기존 OpenAI/LLM provider 및 server route/action 없음
- Runtime schema:
  - 직접 사용하는 Zod 없음
  - strict 수동 parser 사용

---

## Phase A — Domain / Provider Contracts

Status:

```text
COMPLETE
```

기록:

```text
implementation commit: 82998f0 feat(voice): add direct command route contracts
docs commit: 41f2b88 docs(voice): record stage 3 phase A status
```

구현 파일:

- `apps/web/src/features/voice/domain/direct-command-types.ts`
- `apps/web/src/features/voice/domain/direct-planner-schema.ts`
- `apps/web/src/features/voice/providers/direct-command-planner-provider.ts`
- `apps/web/src/features/voice/providers/testing/fake-direct-command-planner-provider.ts`
- 관련 unit tests / public exports

검증:

- Phase A targeted: 2 files, 10 tests PASS
- Web regression: 58 files, 424 tests PASS
- Editor Core regression: 6 files, 47 tests PASS
- Web typecheck: PASS
- Editor Core typecheck: PASS
- Targeted ESLint / Web package lint: PASS
- `git diff --check`: PASS

Known environment notes:

- 현재 자동 테스트 실패 없음
- Stage 2 문서의 기존 Raw Gaze 실패는 현재 HEAD에서 재현되지 않음
- 저장소 요구 Node `>=22`, 실제 검증 Node `20.19.4` → engine warning
- Web regression 중 jsdom canvas 미구현 stderr가 1회 출력됐지만 테스트 PASS

Phase B contract alignment:

```text
Phase A 완료 상태는 유지한다.

다만 최종 Grounding Architecture를 위해:
DirectTargetRef 중심 target schema
→ TargetQuery 중심 schema로 확장한다.

Provider / Fake Provider / strict parser의 기본 구조는 재사용한다.
```

---

## Phase B — Command Context / Frozen Target Grounding / Eligibility

Status:

```text
NEXT MILESTONE
```

범위:

```text
Phase A target contract alignment
Existing semantic/editable grounding source 조사
TargetQuery
PageTargetCatalog
DirectCommandContextBuilder
Candidate Evidence / Ranking
FrozenTargetResolver
ResolvedTarget
Scene Revision Guard
PDF read-only / Editable Guard
```

절대 포함하지 않음:

```text
실제 LLM network call
VLM / screenshot
Editor mutation
Spatial placement
```

완료 후 기록:

```text
contract alignment commit:
implementation commit:
docs commit:
supported document candidates:
supported editable candidates:
supported evidence:
unsupported semantic/math mappings:
tests:
notes:
```

---

## Phase C — Text Planner / Conditional Disambiguation

Status:

```text
PENDING
```

예정:

```text
Raw Final Transcript
+ Frozen Planner Context
→ 최초 Planner 1회
→ refine + intent + relation + command + TargetQuery

Resolver AMBIGUOUS only
→ candidate-only Text Disambiguator
```

VLM은 사용하지 않는다.

---

## Phase D — Editor Runtime Integration

Status:

```text
PENDING
```

예정:

```text
ResolvedTarget
→ Capability Compiler
→ Existing Editor Runtime
→ Operation Log
```

PDF 원문은 변경하지 않는다.

---

## Phase E — Relation / History / Idempotency

Status:

```text
PENDING
```

---

## Phase F — Diagnostics / Completion

Status:

```text
PENDING
```

---

# 11. Known Constraints

현재 설계상 고정:

```text
Gaze 미사용
Direct Route 이미지 미사용
LLM objectId 생성 금지
LLM 좌표 출력 금지
PDF source 완전 read-only
PDF는 Resolver 검색 대상
Ggulnote object는 editable capability 범위에서 수정 가능
Spatial request는 no commit
Ambiguous target 추측 실행 금지
Planner 결과 strict validation 필수
Mutation은 기존 Editor History 경로 사용
```

---

# 12. Phase B 완료 시 반드시 기록할 것

```text
implementation start HEAD:
contract alignment commit:
Phase B implementation commit:
docs commit:
current HEAD:

Frozen Snapshot source:
PageTargetCatalog source adapters:

PDF candidates:
Editable candidates:

TargetQuery supported:
ResolvedTarget supported:

Evidence implemented:
- type:
- lexical:
- fuzzy:
- temporal:
- structural:
- focus:
- semantic:
- math:

Current limitations:
- exact text span mapping:
- sentence/paragraph mapping:
- math subrange:
- ink recognition:

Validation:
- targeted:
- voice regression:
- web:
- editor-core:
- typecheck:
- lint:
- git diff --check:
```

---

# 13. Stage 3 최종 완료 시 E2E

```text
"여기 밑줄 쳐줘"
"세종대왕의부터 업적까지 밑줄 쳐줘"
"노란색으로 하이라이트해줘"
"AI의 문제점을 설명하는 문장 하이라이트"
"밑줄 아니 밑줄 말고 노란색 하이라이트"
"노란색 말고 파란색으로"
"다음 페이지"
"이전 페이지"
"방금 거 취소해"
editable text replace
PDF source text replace blocked
ambiguous target no blind commit
spatial command deferred
duplicate turn exactly once
stale scene no commit
```
