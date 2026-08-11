# Stage 4 — Candidate-Constrained Multimodal Spatial Placement: STATUS

## 1. 현재 상태

```text
Stage: 4 — Candidate-Constrained Multimodal Spatial Placement
Status: IN PROGRESS
Current Milestone: Phase B — Deterministic Placement Candidate Engine (NEXT; NOT STARTED)
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
0087ef5428f6c73fa701c7ff14fa31ee5cf0db2a
```

Stage 4 base/start HEAD:

```text
0087ef5428f6c73fa701c7ff14fa31ee5cf0db2a
```

Working tree:

```text
Stage 3.5 branch handoff 시 clean
Phase A docs commit 후 clean (최종 검증에서 재확인)
```

중요:

```text
Stage 3.5 branch의 실제 working tree에는 미커밋 변경이 없었다.
final commit과 회귀 검증을 확인한 뒤 해당 commit에서 Stage 4 branch를 생성했다.
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

실제 재검증 결과:

```text
original branch: feat/stage-3.5-robust-grounding
original/final HEAD: 0087ef5428f6c73fa701c7ff14fa31ee5cf0db2a
initial/final working tree: clean
dirty changes: 없음

명확한 fixture:
deterministic RESOLVED
LLM Recovery 0회

duplicate ambiguity fixture:
AMBIGUOUS
Recovery 1회
Candidates <= 4

targeted TextSpan/Hybrid/Recovery: 3 files / 37 PASS

Web full: 99 files / 671 PASS
Editor Core full: 7 files / 52 PASS

Web/Editor typecheck: PASS
Web/Editor lint: PASS
git diff --check: PASS

environment: Node 20.19.4 (repo requires >=22), pnpm 10.9.0
known non-failure output: Node engine warning, jsdom canvas getContext stderr,
Editor Core lint의 기존 React/pages-directory warning
```

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
COMPLETE
```

완료 기록:

```text
Stage 3.5 final commit: 0087ef5428f6c73fa701c7ff14fa31ee5cf0db2a
Stage 3.5 test results: targeted 37, Web 671, Editor Core 52 PASS
Stage 3.5 docs completion: COMPLETE / READY FOR STAGE 4
old branch: feat/stage-3.5-robust-grounding
new branch: feat/stage-4-multimodal-spatial-placement
Stage 4 base/start: 0087ef5428f6c73fa701c7ff14fa31ee5cf0db2a
source-of-truth docs commit: bdb2247
actual Planner path: apps/web/src/features/voice/domain/direct-command-types.ts,
  direct-planner-schema.ts
actual Grounding path: apps/web/src/features/voice/application/target-strategy-router.ts,
  frozen-target-resolver.ts, grounded-target-recovery.ts
actual Scene path: packages/editor-core/src/scene-core/*,
  apps/web/src/features/voice/integration/editor-voice-context.ts
actual Editor path: packages/editor-core/src/engine/editor-engine.ts,
  apps/web/src/features/voice/application/direct-command-capability-compiler.ts
actual AI provider path: apps/web/src/features/voice/providers/*,
  apps/web/src/features/voice/server/direct-command-ai-server.ts
```

---

## Phase A — Spatial Contract / Frozen Spatial Scene

Status:

```text
COMPLETE
```

완료 기록:

```text
implementation commit: 62bb0b8
docs commit: 이 STATUS/CHECKLIST 갱신 commit
planner contract: ExecutableDirectPlan에 optional targetQuery/placementQuery 추가.
  targetQuery 없음은 new draft subject, targetQuery 있음은 reposition subject를 의미한다.
  기존 command.target은 Stage 3 direct target으로 유지한다.
strict validation: 수동 strict parser가 placement/reference/TargetQuery를 검증하며
  unknown relation/field, coordinate/size/bounds, objectId/candidateId를 reject한다.
  plain/null-prototype object만 허용하고 malformed/prototype-bearing object를 reject한다.
DEFER_SPATIAL migration: 기존 terminal contract는 유지한다. placementQuery가 있는
  EXECUTABLE plan은 Phase E 연결 전까지 Guard에서 SPATIAL_REQUIRED로 no-commit 처리한다.
scene snapshot adapter: ExistingSceneSpatialSceneSource + SpatialSceneSource contract,
  FakeSpatialSceneSource. 기존 FrozenSceneSnapshotSource의 SceneSnapshot을 재사용한다.
coordinate space: PAGE_CANONICAL만 저장하고 page/editable/viewport bounds를 검증한다.
  zoom/DPR은 contract에 없으며 invalid geometry를 clamp/추정하지 않는다.
protection policy: PDF base HARD, canvas object HARD,
  underline/highlight/strikethrough SOFT, invisible object IGNORE.
profile/measurement boundary: PlacementProfileProvider, DraftMeasurementProvider,
  Fake providers, existing object render footprint 측정 helper. capability switch 없음.
domain contracts: PlacementProfile, MeasuredDraft, SpatialSceneSnapshot/Object,
  ProtectionPolicy, ResolvedSpatialAnchor, PlacementCandidate/ResolvedPlacement,
  SpatialPlacementResult/Error/Reason.
tests: Phase A schema/scene/profile/guard 39 PASS;
  direct planner/route/scene integration 57 PASS;
  Stage 3.5 targeted 37 PASS; Web full 102 files / 705 PASS;
  Editor Core 7 files / 52 PASS; Web/Editor typecheck PASS;
  Web full + targeted lint PASS; git diff --check PASS.
limitations: production renderer/offscreen measurement와 profile registry adapter 없음;
  SceneObject에 별도 renderBounds가 없어 Phase A는 authoritative bounds를 사용;
  speech-start frozen canonical viewport가 없어 caller가 frozen canonical bounds를 제공해야 함;
  production screenshot/ghost preview 및 spatial create/move runtime route 없음.
next milestone: Phase B — Deterministic Placement Candidate Engine (미착수)
```

---

## Phase B — Deterministic Placement Candidate Engine

Status:

```text
NEXT — NOT STARTED
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
feat/stage-4-multimodal-spatial-placement
HEAD: bdb2247 (Phase 0 조사 시점)
git status: Phase 0 STATUS/CHECKLIST 갱신만 의도적으로 modified
Stage 3.5 final commit: 0087ef5428f6c73fa701c7ff14fa31ee5cf0db2a
Stage 3.5 implementation/docs: Stage 3.5 STATUS의 COMPLETE 기록과 git log 확인
Stage 3.5 tests: targeted 37 / Web 671 / Editor Core 52 PASS,
  Web+Editor typecheck/lint PASS
Stage 3.5 known failures: 없음
Environment warning: Node 20.19.4, repository requires Node >=22
```

## Planner / Grounding

```text
CommandPlan: ExecutableDirectPlan + DirectEditorCommand
  (apps/web/src/features/voice/domain/direct-command-types.ts)
runtime validator: parseDirectPlannerResult / parseDirectEditorCommand / parseTargetQuery
  (apps/web/src/features/voice/domain/direct-planner-schema.ts)
DEFER_SPATIAL: strict planner terminal result -> DEFERRED_SPATIAL, no commit
  (direct-command-planning-pipeline.ts / direct-command-route.ts)
TargetQuery: text_span | semantic_unit | object | relative | subrange
  (apps/web/src/features/voice/domain/target-query.ts)
Target Grounding Router: TargetStrategyRouter -> FrozenTargetResolver
Relative/TextSpan/SemanticUnit/Object: frozen-target-resolver.ts,
  text-span-grounder.ts, target-strategy-router.ts
Grounded Recovery: grounded-target-recovery.ts + same-origin provider/server boundary
Frozen Context: voice-turn-types.ts / voice-turn-context-source.ts
Scene Revision: CurrentRevisionSceneSnapshotSource + guard revision equality
Guard: direct-command-guard.ts; idempotency: direct-command-execution-registry.ts
```

## Scene / Geometry

```text
PDF bounds: PDF.js scale-1 rotation-aware viewport -> PageDescriptor -> ScenePage
PDF semantic bounds: normalized semantic bounds -> buildPdfSceneObjects canonical rect
Canvas bounds: SerializedAnnotation normalized bounds -> annotationToSceneObject canonical rect
Annotation bounds: PageSceneSnapshot.annotations가 source of truth
renderBounds: 별도 필드/API 없음; 현재 SceneObject.bounds가 유일한 canonical footprint
canonical transform: packages/editor-core/src/scene-core/coordinate.ts
zoom/DPR/rotation: pdf-page-renderer.ts가 CSS/render pixel과 scale-1 page size를 분리;
  scene bounds에는 zoom/DPR 미포함
viewport: DocumentStage DOM/CSS viewport는 있으나 frozen canonical viewport contract 없음
focus: FrozenVoiceTurnContext.focusObjectId/focusBounds
selection: EditorSnapshot.selectedAnnotationId -> frozen selection focus candidate
pointer: DocumentWorkspace normalized pointer; speech-start frozen context에는 미포함
screenshot: CompositeRenderSnapshot contract만 존재, production composed capture 구현 없음
collision/index: scene-core/occupancy.ts, placement.ts, placement-validator.ts
debug overlay: scene-core-debug-panel.tsx와 DocumentWorkspace semantic overlay
```

## Editor / Provider

```text
capability registry: packages/editor-core/src/scene-core/capability-registry.ts
measurement: VoiceCapability.estimateFootprint contract만 있고 production 등록/renderer adapter 없음
preview/scratch: persistent하지 않는 ghost/scratch API 없음; UI drag preview만 존재
create: EditorEngine.createAnnotation -> CreateAnnotationCommand
move: EditorEngine drag/moveSelected -> MoveAnnotationCommand
compiler: apps/web/src/features/voice/application/direct-command-capability-compiler.ts
runtime: editor-direct-command-executor.ts -> EditorEngine
CommandManager: packages/editor-core/src/commands/command-manager.ts
Operation Log: EditorEngine.publishOperation / subscribeToOperations
Undo: CommandManager undo/redo stack, EditorEngine.undo/redo
IndexedDB: PersistenceCoordinator가 Editor operation 후 PageSceneSnapshot/operation 저장
AI provider/server: Http providers -> /api/voice/direct-command/* -> server-only OpenAI transport
```

---

# 9. Phase 0에서 확인한 현재 제한

실제 코드로 확인:

```text
기존 renderer offscreen measurement: 미지원; canvas renderer 내부 measureText만 존재
scratch/ghost layer: 없음
Canvas object renderBounds: 별도 필드 없음; SceneObject.bounds만 canonical
composed screenshot API: contract만 있고 production capture 없음
move/reposition operation: annotation move는 존재, generic spatial compiler 연결은 없음
새 page/canvas expansion capability: 없음
기존 spatial index/collision utility: rect-based occupancy/placement/validator 존재
현재 planner schema DEFER_SPATIAL: reasonCode만 가진 terminal no-commit result
```

확인 전 임의 새 subsystem을 만들지 않는다.

Phase A에서는 위 제한을 숨기기 위한 fallback geometry, screenshot, preview,
candidate generator 또는 runtime integration을 추가하지 않았다.
