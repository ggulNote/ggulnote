# Stage 4 — Candidate-Constrained Multimodal Spatial Placement: STATUS

## 1. 현재 상태

```text
Stage: 4 — Candidate-Constrained Multimodal Spatial Placement
Status: READY TO START
Current Milestone: Phase 0 — Stage 3.5 Handoff / Branch / Existing Architecture
```

Stage 4는 Stage 3 / 3.5를 대체하지 않는다.

추가 목표:

```text
SpatialPlacementQuery
Frozen Spatial Scene
Safe Placement Candidates
Deterministic Fast Path
Ambiguous-only Multimodal Judge
Ghost Preview
Deterministic Validation
Existing Editor Runtime Commit
```

---

# 2. Branch

출발 예상 branch:

```text
feat/stage-3.5-robust-grounding
```

새 branch:

```text
feat/stage-4-multimodal-spatial-placement
```

Stage 3.5 final commit:

```text
TBD — Phase 0에서 실제 git log와 Stage 3.5 STATUS 기준으로 기록
```

Stage 4 base/start HEAD:

```text
TBD — branch 생성 시 기록
```

Working tree:

```text
TBD — Phase 0에서 실제 확인
```

중요:

```text
Stage 3.5 handoff 요약에는 미커밋 변경이 남아 있다고 보고되어 있다.
실제 상태를 재확인하고,
Stage 3.5 관련 변경은 현재 branch에서 완료/커밋한 뒤
clean final commit에서 Stage 4 branch를 생성한다.
```

금지:

```text
git reset --hard
git clean
무단 git stash
unrelated 변경 삭제
Stage 3.5 변경을 Stage 4 commit에 섞기
```

---

# 3. Source of Truth

```text
AGENTS.md
> docs/tasks/stage-4-multimodal-spatial-placement/DECISIONS.md
> docs/tasks/stage-4-multimodal-spatial-placement/SPEC.md
> docs/tasks/stage-4-multimodal-spatial-placement/CHECKLIST.md
> docs/tasks/stage-4-multimodal-spatial-placement/STATUS.md
```

Dependency:

```text
docs/tasks/stage-3.5-robust-grounding/*
docs/tasks/stage-3-direct-command-route/*
Stage 1 Scene/Semantic docs
Stage 2 Voice Turn docs
Editor Core / Persistence docs
```

---

# 4. Stage 3.5 Handoff — 재검증 대상

전달받은 요약:

```text
Current branch:
feat/stage-3.5-robust-grounding

명확한 fixture:
deterministic RESOLVED
LLM Recovery 0회

duplicate ambiguity fixture:
AMBIGUOUS
Recovery 1회
Candidates <= 4

targeted tests:
37 PASS

Editor Core:
52 PASS

Web/Editor typecheck:
PASS

Working tree:
uncommitted changes preserved
```

위 내용은 Phase 0에서 실제 repository로 재검증한다.

---

# 5. 최종 Stage 4 아키텍처

```text
CompletedVoiceTurn
        ↓
Existing Direct Planner
        ↓
CommandPlan + placementQuery?
        ↓
Frozen SpatialSceneSnapshot
        ↓
Grounding Orchestrator
 ├─ Existing Target Grounding Router
 └─ Spatial Placement Resolver
        ↓
PlacementProfile + MeasuredDraft
        ↓
Geometry Candidate Generator
        ↓
Hard Filter / Dedupe / Dominance / Diversity
        ↓
Deterministic Gate
        ├─ RESOLVED
        ├─ NO_FEASIBLE_PLACEMENT
        └─ AMBIGUOUS
               ↓
      Bounded Multimodal Judge
       Global + Local + S1...Sn
               ↓
             S* | NONE
               ↓
          Ghost Preview
               ↓
      Deterministic Validator
               ↓
 Existing Guard / Compiler / Runtime
               ↓
 CommandManager / Operation Log / Undo
```

핵심 권한 분리:

```text
Planner
→ 의미적 placementQuery

Stage 3.5 Grounder
→ 실제 anchor/subject

Code
→ 실제 후보 geometry와 alias

VLM
→ 현재 S1...Sn 중 하나 또는 NONE

Preview/Validator
→ 실제 render 검증

Editor
→ 검증된 operation만 commit
```

---

# 6. 고정 Constraints

```text
VLM 좌표 생성 금지
VLM 실제 objectId 생성 금지
VLM 새 후보 발명 금지

Structured Scene geometry authoritative
Screenshot은 시각 판단 보조

Deterministic path VLM 0회
Ambiguous path VLM 최대 1회
Final candidates 최대 6개
Preview retry 최대 1회

하나의 frozen sceneRevision
stale scene no commit

PDF source immutable
기존 Editor Runtime/Undo/Operation Log 재사용
동일 turnId exactly once

새 OCR/YOLO 없음
새 Gaze integration 없음
새 Table/Graph/Math capability 없음
자율 Agent loop 없음
```

---

# 7. Phase 상태

## Phase 0 — Stage 3.5 Handoff / Branch / Existing Architecture

Status:

```text
CURRENT MILESTONE
```

완료 후 기록:

```text
Stage 3.5 final commit:
Stage 3.5 test results:
Stage 3.5 docs completion:
old branch:
new branch:
Stage 4 base:
start HEAD:
working tree:
actual Planner path:
actual Grounding path:
actual Scene path:
actual Editor path:
actual AI provider path:
```

---

## Phase A — Spatial Contract / Frozen Spatial Scene

Status:

```text
PENDING
```

완료 후 기록:

```text
implementation commit:
docs commit:
planner contract:
strict validation:
scene snapshot adapter:
coordinate space:
protection policy:
profile/measurement boundary:
tests:
limitations:
next milestone: Phase B
```

---

## Phase B — Deterministic Placement Candidate Engine

Status:

```text
PENDING
```

완료 후 기록:

```text
occupancy implementation:
relative slots:
free-space fallback:
candidate cap:
dominance policy:
deterministic fixtures:
ambiguous fixtures:
debug surface:
tests:
next milestone: Phase C
```

---

## Phase C — Bounded Multimodal Placement Judge

Status:

```text
PENDING
```

완료 후 기록:

```text
observation builder:
global screenshot:
local crop:
candidate marks:
provider:
strict response:
call policy:
tests:
next milestone: Phase D
```

---

## Phase D — Ghost Preview / Deterministic Validation

Status:

```text
PENDING
```

완료 후 기록:

```text
preview renderer:
persistent mutation assertion:
validator:
retry:
tests:
next milestone: Phase E
```

---

## Phase E — Planner / Compiler / Runtime Integration

Status:

```text
PENDING
```

완료 후 기록:

```text
routing:
supported capabilities:
compiler/runtime:
operation log:
undo:
idempotency:
E2E:
next milestone: Phase F
```

---

## Phase F — Diagnostics / Evaluation / Completion

Status:

```text
PENDING
```

완료 후 기록:

```text
metrics:
full regressions:
typecheck:
lint:
git diff --check:
known issues:
final implementation commit:
final docs commit:
Stage 4 status:
next-stage handoff:
```

---

# 8. Phase 0 조사 템플릿

## Git / Handoff

```text
branch:
HEAD:
git status:
Stage 3.5 final commit:
Stage 3.5 implementation commits:
Stage 3.5 docs commit:
Stage 3.5 tests:
Stage 3.5 known failures:
```

## Planner / Grounding

```text
CommandPlan:
runtime validator:
DEFER_SPATIAL:
TargetQuery:
Target Grounding Router:
Grounded Recovery:
Frozen Context:
Scene Revision:
Guard:
```

## Scene / Geometry

```text
PDF bounds:
Canvas bounds:
Annotation bounds:
renderBounds:
canonical transform:
viewport:
focus:
selection:
pointer:
screenshot:
collision/index:
debug overlay:
```

## Editor / Provider

```text
capability registry:
measurement:
preview/scratch:
create:
move:
compiler:
runtime:
CommandManager:
Operation Log:
Undo:
IndexedDB:
AI provider/server:
```

---

# 9. 현재 알려지지 않은 사항

Phase 0에서 실제 코드로 확인:

```text
기존 renderer가 offscreen measurement를 지원하는지
scratch/ghost layer가 존재하는지
Canvas object renderBounds가 canonical coordinate인지
composed screenshot API가 있는지
move/reposition operation이 존재하는지
새 page/canvas expansion capability가 있는지
기존 spatial index/collision utility가 있는지
현재 planner schema가 DEFER_SPATIAL을 어떻게 표현하는지
```

확인 전 임의 새 subsystem을 만들지 않는다.
