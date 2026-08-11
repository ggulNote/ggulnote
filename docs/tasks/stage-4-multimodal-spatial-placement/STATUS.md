# Stage 4 — Candidate-Constrained Multimodal Spatial Placement: STATUS

## 1. 현재 상태

```text
Stage: 4 — Candidate-Constrained Multimodal Spatial Placement
Status: BLOCKED
Current Milestone: Phase F — verification complete; production multimodal opt-in required
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
Phase B docs commit과 최종 검증 후 clean
Phase C implementation/docs commit과 최종 검증 후 clean
Phase D implementation/docs commit과 최종 검증 후 clean
Phase E/F implementation/docs commit과 최종 검증 후 clean
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
next milestone: Phase B — 완료; 아래 Phase B 기록 참조
```

---

## Phase B — Deterministic Placement Candidate Engine

Status:

```text
COMPLETE (순수 spatial decision layer)
```

완료 기록:

```text
start HEAD: 1657ffdb4f26d1b4791f42cd47c6d2f2a0305398
implementation commit: 335e716
docs commit: 이 STATUS/CHECKLIST 갱신 commit

implementation:
  apps/web/src/features/voice/application/spatial-occupancy-index.ts
  apps/web/src/features/voice/application/spatial-anchor-resolver.ts
  apps/web/src/features/voice/application/placement-candidate-engine.ts
  동일 경로의 targeted test 3개와 domain/application/feature barrel

occupancy implementation: PAGE_CANONICAL Rect exact intersection 기반.
  HARD/SOFT/IGNORE를 분리하고 profile minClearance로 HARD bounds를 inflate한다.
  editable containment, actual hard/soft overlap area, nearest clearance,
  nearby object와 blocking HARD object를 deterministic하게 제공한다.

anchor adapter: TARGET은 외부 Stage 3.5 TargetResolutionResult만 소비하며 재-grounding하지 않는다.
  FOCUS/PAGE/VIEWPORT는 동일 frozen SpatialSceneSnapshot에서 resolve한다.
  page/revision mismatch는 STALE_SCENE, bounds 부재는 ANCHOR_NOT_FOUND다.

relative slots: ABOVE/BELOW/LEFT_OF/RIGHT_OF start/center/end,
  NEAR representative four directions, INSIDE/AT explicit overlay policy.
  HARD 충돌 시 relation 방향의 겹친 object far edge + minClearance로만 이동하며
  iteration은 hard object count + 2로 제한한다. 좌표 clamp는 없다.

free-space fallback: page/viewport/region representative seed와 HARD object의
  left/right/top/bottom clearance edge를 축별 최대 12개로 제한해 조합한다.
  TOP/BOTTOM/LEFT/RIGHT/MARGIN/CURRENT_VIEW는 search domain/evidence로 반영한다.
  raster/bitmap/CV/외부 spatial dependency는 없다.

footprint: MeasuredDraft preferred 우선. preferred 결과가 없고 resizePolicy가
  FIXED가 아닐 때만 measured/profile compact를 최대 한 번 시도한다.

filter/prune: invalid/NaN/Infinity/non-positive/min-size/max-size/out-of-bounds,
  HARD overlap/clearance, relation, overlay policy를 hard reject한다.
  SOFT overlap은 evidence만 기록한다. PAGE_CANONICAL epsilon dedupe 후
  relation/preferred/alignment/soft-overlap/clearance/anchor-distance의 보수적
  Pareto dominance만 제거하고 strategy/alignment/size round-robin diversity를 적용한다.

candidate cap/order: final <= 6. shortlist 정렬 뒤 S1...Sn과 deterministic internalId를
  발급한다. opaque weighted score는 없다.

deterministic gate: 0 -> NO_FEASIBLE_PLACEMENT, 1 -> RESOLVED,
  하나가 모든 대안을 dominance할 때만 RESOLVED, 그 외 AMBIGUOUS.
  snapshot/revision mismatch는 STALE_SCENE다.

debug surface: JSON-safe diagnostics에 anchor/editable/draft, HARD/SOFT bounds,
  raw/filtered/deduped/pruned/final count, filtered reason, candidate evidence,
  PAGE_CANONICAL identity와 gate result를 제공한다. Phase B 완료 당시 남겨 둔
  visual S1 overlay는 Phase C local candidate crop에서 구현했다.

tests:
  Phase B targeted: 3 files / 38 PASS
  Phase A targeted: 4 files / 39 PASS
  Stage 3.5 TextSpan/FrozenHybrid/Recovery: 3 files / 36 PASS
    (이전 STATUS의 37 baseline과 현재 test enumeration이 1개 다르나 failure 없음)
  Web full: 105 files / 743 PASS
  Editor Core full: 7 files / 52 PASS
  Web/Editor typecheck: PASS
  Web/Editor full lint: PASS
  git diff --check: PASS

known non-failure output: Node 20.19.4 (repo requires >=22) engine warning,
  expected provider validation stderr, jsdom canvas getContext stderr,
  Editor Core lint existing React/pages-directory warnings.

boundaries: AI/VLM/provider/network/screenshot/candidate image/preview/runtime mutation,
  CommandManager/Operation Log/Undo/IndexedDB write를 추가하지 않았다.
  placement route와 move subject grounding/runtime 연결은 Phase E에 남아 있다.

next milestone: Phase C — 완료; 아래 Phase C 기록 참조
```

---

## Phase C — Bounded Multimodal Placement Judge

Status:

```text
COMPLETE (candidate-constrained multimodal choice; preview/commit 없음)
```

완료 기록:

```text
start HEAD: 12cd26afde9173b3837e0045e4db289e89b464b0
implementation commit: 9e6ad1b
docs commit: 이 STATUS/CHECKLIST 갱신 commit

observation builder:
  apps/web/src/features/voice/application/multimodal-placement-observation.ts
  AMBIGUOUS의 final candidates 2~6개만 받아 request-scoped S1...Sn을 발급한다.
  instruction/draft/anchor text는 중앙 limit로 축약하고 exact geometry는 outbound
  metadata에 포함하지 않는다. diagnostics에는 image dimension/byte size/latency와
  alias/count만 기록하며 image data와 document raw text를 기록하지 않는다.

actual screenshot source / composed capture:
  apps/web/src/features/voice/integration/canvas-spatial-screenshot-source.ts
  기존 PDF base canvas와 Editor annotation/canvas layer를 흰색 bounded canvas에
  합성하는 얇은 adapter다. PDF는 두 layer 중 하나라도 없으면 UNAVAILABLE이고,
  Blank는 white base + Editor overlay를 사용한다. 새 renderer/dependency는 없다.
  editor-core buildCompositeRenderSnapshot으로 capture 전후 page/revision을 검증한다.

global overview / local crop:
  capture max edge 2048, global max edge 1280, local max edge 1536의 중앙 config.
  global은 page 전체 aspect ratio를 유지한다. local은 anchor+candidates union 또는
  FREE_SPACE candidate union에 canonical padding을 더한 뒤 image crop만 clamp한다.

canonical -> pixel / candidate marks:
  PAGE_CANONICAL page bounds와 screenshot pixel size의 명시적 scaleX/scaleY만 쓴다.
  execution candidate rect는 수정하지 않는다. local crop에는 footprint outline과
  alias badge만 그리며 실제 draft preview는 하지 않는다. badge는 outside/inside
  corner의 bounded deterministic 순서로 배치하고 이전 badge와의 충돌을 피한다.

alias / metadata boundary:
  Phase B internalId/기존 alias와 무관하게 observation 순서로 outbound S1...Sn을
  다시 발급하고 현재 observation의 Map에서만 resolve한다. objectId, candidateId,
  neighbor ID, draft key, Scene JSON, 전체 PDF text, raw x/y/width/height/bounds는
  provider request에 포함하지 않는다. clearance/soft overlap은 category만 보낸다.

provider / production boundary:
  MultimodalPlacementJudgeProvider, Fake provider,
  HttpMultimodalPlacementJudgeProvider, Llm provider를 추가했다.
  browser는 same-origin /api/voice/direct-command/placement-judge만 호출한다.
  server-only OpenAI Responses multimodal transport가 기존 OPENAI_API_KEY,
  DIRECT_COMMAND_MODEL, DIRECT_COMMAND_AI_TIMEOUT_MS 설정을 그대로 사용한다.
  browser secret은 없고 unit/integration test actual network call도 없다.

strict response:
  정확히 { choice: current S* } 또는 { choice: NONE }만 허용한다.
  plain object/exact key/current alias를 runtime parser가 검증하며 unknown field,
  coordinate, confidence, free text, stale/unknown alias를 reject한다.
  OpenAI transport에도 dynamic enum JSON schema를 사용하지만 runtime validation을
  별도로 유지한다.

invocation / stale / failure policy:
  Phase B AMBIGUOUS에서만 screenshot/image encoding/provider를 각 1회 수행한다.
  deterministic RESOLVED, NO_FEASIBLE_PLACEMENT, STALE_SCENE는 모두 0회다.
  provider retry는 없다. request/transport AbortSignal과 server timeout을 normalize한다.
  응답 적용 전 current page/revision을 다시 확인해 stale response를 reject한다.
  NONE은 NO_FEASIBLE_PLACEMENT(no selection), missing config는 PROVIDER_UNAVAILABLE,
  network/HTTP/timeout은 PROVIDER_ERROR, invalid output은 INVALID_PROVIDER_CHOICE다.

no-side-effect boundary:
  Phase C result는 source=MULTIMODAL인 selected candidate일 뿐 실행 허가가 아니다.
  preview, Editor mutation, CommandManager, Operation Log, Undo, IndexedDB write는 0이다.

tests:
  Phase C targeted: 7 files / 50 PASS
  Phase B targeted: 3 files / 38 PASS
  Phase A targeted: 4 files / 39 PASS
  Stage 3.5 current targeted: 3 files / 36 PASS
  Web full: 112 files / 793 PASS
  Editor Core full: 7 files / 52 PASS
  Web/Editor typecheck: PASS
  Web/Editor full lint: PASS
  git diff --check: PASS

known non-failure output:
  Node 20.19.4 (repo requires >=22) engine warning,
  expected strict provider validation stderr, existing jsdom canvas getContext stderr,
  Editor Core lint existing React/pages-directory warnings.

remaining limitations:
  production capture adapter는 실제 renderer canvas accessor를 받도록 준비됐지만
  spatial runtime route wiring은 Phase E 범위라 아직 DocumentWorkspace에 연결하지 않았다.
  실제 브라우저 page smoke는 그 route가 없어 이번 Phase C에서는 fixture canvas와
  mock server transport로 검증했다. Phase C 완료 시점에 없던 Ghost preview와
  actual bounds validation은 Phase D에서 추가했다.

next milestone: Phase D — Ghost Preview / Deterministic Validation
```

---

## Phase D — Ghost Preview / Deterministic Validation

Status:

```text
COMPLETE (non-persistent production renderer preview + deterministic validation)
```

완료 기록:

```text
start HEAD: 79582700d069b7e04a384cebcf6d35617936c859
implementation commit: 78096b7
docs commit: 이 STATUS/CHECKLIST 갱신 commit

implementation:
  apps/web/src/features/voice/domain/spatial-preview-types.ts
  apps/web/src/features/voice/application/spatial-preview-renderer.ts
  apps/web/src/features/voice/application/spatial-preview-validator.ts
  apps/web/src/features/voice/application/preview-validation-orchestrator.ts
  apps/web/src/features/voice/integration/canvas-annotation-spatial-preview-renderer.ts
  동일 경로의 targeted test 3개와 domain/application/integration/feature barrel

existing renderer / preview surface:
  DocumentWorkspace가 사용하는 NativeCanvasRenderer와 editor-core AnnotationFactory를
  재사용한다. capability-owned createAnnotationInput adapter가 실제 content/style을
  제공하고 capability-keyed preview registry가 renderer를 선택하므로 중앙 capability
  if-chain은 없다. 임시 Annotation은 EditorEngine/Scene에 삽입하지 않고 선택 불가,
  pointer-events:none인 ephemeral canvas 하나에만 렌더한다.

actual render bounds / coordinate:
  실제 renderer가 그린 transparent canvas alpha pixels의 최소 bounding rect를 측정한다.
  fixed DPR 1 preview pixel과 frozen pageBounds의 명시적 scale로 PAGE_CANONICAL bounds를
  반환하며 browser zoom/DPR/screen rect를 execution geometry에 섞지 않는다.
  candidate가 page 밖이면 production AnnotationFactory에 넘기기 전에 reject하며 clamp하지 않는다.

lifecycle / non-persistent boundary:
  render -> measure -> validate -> dispose 순서다. success, validation failure,
  stale-after-render, abort, fallback, renderer exception에서 transient surface cleanup을
  보장하고 dispose는 idempotent하다. Editor mutation, CommandManager, Operation Log,
  IndexedDB, Undo, autosave 포트는 없으며 테스트에서 모두 0회임을 확인했다.

validator:
  actual bounds finite/positive, editable containment, profile minimum size,
  candidate footprint + 중앙 render tolerance(1 canonical unit), HARD overlap와
  minClearance, relation, explicit alignment, overlay policy, snapshot/page/revision,
  draftKey/candidate internalId를 deterministic하게 검증한다. SOFT overlap은 reject하지
  않고 area/object count evidence로 남긴다. 실제 bounds를 clamp/resize하지 않는다.

result contract:
  SelectedSpatialPlacement는 Phase C alias가 resolve된 authoritative internal candidate다.
  성공만 ValidatedSpatialPlacement가 되며 requested/actual bounds, page/revision,
  candidate internalId, draftKey, DETERMINISTIC/MULTIMODAL/VALIDATION_FALLBACK source,
  attempt count와 validation evidence를 보존한다. 실패는 VALIDATION_FAILED,
  PREVIEW_UNAVAILABLE, PREVIEW_RENDER_FAILED, STALE_SCENE, ABORTED로 구분한다.

revision / abort / error policy:
  preview 전후 current page/revision을 확인한다. stale/abort/infrastructure error는
  fallback하지 않는다. renderer 미등록 또는 capability adapter input 부재는
  PREVIEW_UNAVAILABLE이며 안전하다고 추측하지 않는다.

fallback:
  primary가 실제 geometry/render-fit 실패일 때만 Phase B shortlist stable order의
  첫 다른 candidate를 최대 한 번 preview+validate한다. 총 attempt <= 2,
  추가 VLM/screenshot call은 0이다. INVALID_RENDER_GEOMETRY/stale/abort/unavailable/
  renderer failure는 fallback하지 않으며 두 번째 invalid는 VALIDATION_FAILED다.

tests:
  Phase D targeted: 3 files / 31 PASS
  Phase C targeted: 7 files / 50 PASS
  Phase B targeted: 3 files / 38 PASS
  Phase A targeted: 4 files / 39 PASS
  Stage 3.5 current targeted: 3 files / 36 PASS
  Web full: 115 files / 824 PASS
  Editor Core full: 7 files / 52 PASS
  Web/Editor typecheck: PASS
  Web/Editor full lint: PASS
  git diff --check: PASS

known non-failure output:
  Node 20.19.4 (repo requires >=22) engine warning,
  expected strict provider validation stderr, existing jsdom canvas getContext stderr,
  Editor Core lint existing React/pages-directory warnings.

remaining limitations:
  Phase D infrastructure는 production-capable하지만 DocumentWorkspace의 spatial voice
  route 및 capability-specific createAnnotationInput 등록은 Phase E 범위라 아직 wiring하지 않았다.
  현재 NativeCanvasRenderer의 TEXT는 assigned annotation bounds 안에서 clip하므로
  현재 renderer 자체가 auto-grow하지 않는다. 향후 auto-layout renderer도 같은 preview
  session contract에서 actual painted bounds를 반환할 수 있다. move/create commit,
  CommandManager/Operation Log/Undo/IndexedDB integration은 구현하지 않았다.

next milestone: Phase E — Planner / Compiler / Runtime Integration
```

---

## Phase E — Planner / Compiler / Runtime Integration

Status:

```text
IMPLEMENTED WITH LIMITATIONS
```

구현 결과:

```text
start HEAD: f65a5e4c789d47ec26d63f33f8b2f39b6270a9d9
implementation commit: ec2c42e8628c627e54cbf8f7922d690f4c369243
test commit: 153f238d583809253f7f49833e285dde6db896a2

routing:
  placementQuery가 없으면 기존 DirectCommandRoute를 그대로 사용한다.
  placementQuery가 있으면 SpatialPlacementExecutionPipeline만 진입한다.
  지원되는 text.create는 기존 DEFER_SPATIAL no-commit 경계에서 승격되며,
  지원되지 않는 spatial capability는 UNSUPPORTED_CAPABILITY로 종료한다.

orchestration:
  ExistingSceneSpatialSceneSource → Stage 3.5 trusted anchor → capability-owned
  PlacementProfile/MeasuredDraft → Phase B candidate/gate → Phase C bounded choice
  → Phase D preview validation → ValidatedSpatialPlacement → final guard 순서다.
  기존 Phase A-D component를 재사용하며 candidate/search/validation을 복제하지 않는다.

production composition:
  DocumentWorkspace가 current PDF base canvas, annotation canvas, ephemeral preview
  mount를 existing browser composition에 주입한다. CanvasSpatialScreenshotSource와
  NativeCanvasRenderer 기반 CanvasAnnotationSpatialPreviewRenderer를 재사용한다.
  React component는 dependency wiring만 소유한다.

supported capabilities:
  CREATE: text.create → 기존 TEXT annotation / EditorEngine.createAnnotation
  MOVE: 미지원. 기존 generic move는 있지만 trusted subject exclusion과 capability-owned
    materialization을 포함한 spatial move contract가 아직 없어 억지 연결하지 않았다.
  table/graph/math create: 해당 deterministic runtime capability가 없어 미지원.

compiler/runtime:
  compileValidatedSpatialCommand만 spatial compiler entry다. raw candidate, VLM alias,
  screenshot pixel은 입력될 수 없다. capability registry가 preview/commit에 동일한
  TEXT payload factory를 제공하며 기존 CREATE_ANNOTATION과 EditorEngine을 사용한다.

final guard:
  pageId, sceneRevision, snapshot/candidate identity, active page, AbortSignal,
  capability registration을 commit 직전에 확인한다. stale/abort/unsupported는 no commit이다.

operation/history/persistence:
  successful spatial turn은 기존 CommandManager operation 한 건만 만들고 operation
  subscriber/persistence 경계를 그대로 통과한다. Preview는 Scene/Operation Log/Undo/
  IndexedDB를 변경하지 않는다. Undo/Redo로 동일 TEXT object를 제거/복원했다.
  Direct trace는 turnId와 editor operationId를 연결하지만 기존 Editor operation schema는
  변경하지 않는다. DirectOperationRecord에는 source turnId를 보존한다.
  spatial REVISE_LAST/CONTINUE는 아직 지원하지 않는다.

idempotency:
  기존 DirectCommandExecutionRegistry가 동일 turnId의 in-flight/completed 요청을 공유해
  planning/spatial execution/editor mutation을 정확히 한 번만 수행한다.

call counts:
  non-spatial: spatial/screenshot/placement VLM/preview 0
  deterministic spatial: screenshot 0, placement VLM 0, preview 1, commit 1
  ambiguous (injected Fake provider): screenshot 1, placement VLM 1, preview 1, commit 1
  provider NONE/no feasible/preview failure/stale/abort: commit 0

production multimodal boundary:
  placement judge는 explicit injected dependency다. DocumentWorkspace 기본 구성에는
  provider를 등록하지 않는다. 따라서 deterministic spatial create는 production route로
  실행되지만 ambiguous production turn은 PROVIDER_UNAVAILABLE/no commit이다.
  실제 document screenshot을 same-origin server/model로 전송하는 기본 활성화는
  별도 사용자 승인과 제품 consent/configuration 결정이 필요하다.
```

---

## Phase F — Diagnostics / Evaluation / Completion

Status:

```text
VERIFIED; STAGE COMPLETION BLOCKED
```

검증 결과:

```text
metrics:
  spatial trace에 page/revision, anchor, raw/filtered/final candidate count,
  deterministic gate, provider result/call count, screenshot count, selection source,
  preview attempts/result, commit guard, runtime/operation 여부와 단계별 latency를 기록한다.
  image/base64, full PDF text, full Scene JSON은 기록하지 않는다.

evaluation:
  pure fixture aggregator로 Placement Validity, Hard Overlap, Relation, Preferred Size,
  deterministic/multimodal rates, multimodal choice accuracy, false commit/no-commit
  precision, p50/p95 latency, Undo integrity를 계산한다.

tests:
  Phase E/F targeted: 9 files / 72 PASS
  Phase D targeted: 3 files / 31 PASS
  Phase C targeted: 7 files / 50 PASS
  Phase B targeted: 3 files / 38 PASS
  Phase A targeted: 4 files / 39 PASS
  Stage 3.5 current targeted: 3 files / 28 PASS
  Web split full scope: 117 files / 832 PASS
    (마지막 NONE/free-space tests 추가 후 current total 834; affected targeted suite PASS)
  Editor Core full: 7 files / 52 PASS
  Web/Editor typecheck: PASS
  Web/Editor full lint: PASS
  git diff --check: PASS

full-run note:
  단일 Web full command는 이 환경에서 10분 이상 runner가 정체되어 종료했고,
  동일 117개 파일 전부를 domain/application/integration/providers/UI/non-voice/tests로
  분할 실행해 failure 없이 검증했다. maxWorkers 단독 옵션은 Vitest worker config와
  충돌하므로 minWorkers=1/maxWorkers=4를 함께 사용했다.

browser smoke:
  안정적인 CompletedVoiceTurn UI injection harness가 없어 실제 수동 browser smoke는
  실행하지 않았다. jsdom DocumentWorkspace composition과 실제 EditorEngine integration,
  operation/undo/redo를 자동 테스트했다. 실제 OpenAI network call은 0이다.
  PDF/Blank Canvas는 Phase A/B의 공통 canonical engine fixture를 재검증했고 PDF source는
  immutable HARD obstacle로 유지된다. 실제 browser PDF smoke도 같은 이유로 미실행이다.

known non-failure output:
  Node 20.19.4 (repo requires >=22) engine warning,
  expected strict provider validation stderr, existing jsdom canvas getContext stderr,
  Editor Core lint React/pages-directory warnings.

final implementation commit: ec2c42e8628c627e54cbf8f7922d690f4c369243
final test commit: 153f238d583809253f7f49833e285dde6db896a2
final docs commit: 이 STATUS/CHECKLIST commit (git log 기준)
Stage 4 status: BLOCKED

completion blocker:
  production ambiguous path의 document screenshot 전송 및 multimodal provider 기본
  활성화에 대한 명시적 승인/consent가 없다. 이 경계가 해결되기 전에는 Phase C
  production screenshot/VLM exactly-once criterion이 충족되지 않으므로 COMPLETE로
  표시하지 않는다. 승인 후 기존 optional placementJudge 포트에 same-origin provider를
  주입하고 browser ambiguous/failure smoke를 수행해야 한다.

remaining capability coverage:
  spatial MOVE, table/graph/math runtime, new-page/canvas expansion은 Stage 4 pipeline
  완료를 위해 새로 만들지 않았다. TEXT는 기존 NativeCanvasRenderer의 assigned bounds
  clipping semantics를 Preview/Commit 양쪽에서 동일하게 유지한다.

next-stage handoff:
  없음. 위 production multimodal consent blocker 해소와 browser smoke가 먼저다.
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
composed screenshot API: Phase C에 existing PDF/Editor canvas thin adapter 구현;
  runtime route wiring은 Phase E까지 없음
move/reposition operation: annotation move는 존재, generic spatial compiler 연결은 없음
새 page/canvas expansion capability: 없음
기존 spatial index/collision utility: rect-based occupancy/placement/validator 존재
현재 planner schema DEFER_SPATIAL: reasonCode만 가진 terminal no-commit result
```

확인 전 임의 새 subsystem을 만들지 않는다.

Phase A에서는 위 제한을 숨기기 위한 fallback geometry, screenshot, preview,
candidate generator 또는 runtime integration을 추가하지 않았다.
