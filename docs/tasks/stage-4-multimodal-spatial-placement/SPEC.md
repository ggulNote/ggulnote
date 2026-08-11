# Stage 4 — Candidate-Constrained Multimodal Spatial Placement: SPEC

## 0. 목표

Stage 4는 완료된 Stage 3 / 3.5 위에
**구조화 Scene 기반 안전 후보 생성 + deterministic fast path + ambiguous-only multimodal choice + render-and-validate**를 추가한다.

핵심 파이프라인:

```text
CompletedVoiceTurn
        ↓
Existing Direct Planner
        ↓
CommandPlan
 ├─ targetQuery?
 ├─ placementQuery?
 ├─ capability
 ├─ operation
 └─ payload
        ↓
Freeze / Load SpatialSceneSnapshot
        ↓
Grounding Orchestrator
 ├─ Subject Target Grounding
 └─ Reference Anchor Grounding
        ↓
PlacementProfile + MeasuredDraft
        ↓
Placement Candidate Generator
 ├─ Anchor-relative slots
 ├─ Page/region slots
 └─ Coarse free-space fallback
        ↓
Hard Constraint Filter
        ↓
Dedupe / Dominance / Diversity Pruning
        ↓
Deterministic Placement Gate
        ├─ RESOLVED
        ├─ NO_FEASIBLE_PLACEMENT
        └─ AMBIGUOUS
               ↓
      Multimodal Observation Builder
       ├─ Global overview
       ├─ Local candidate crop
       └─ Compact candidate metadata
               ↓
      Multimodal Placement Judge
               ↓
          S1...Sn | NONE
               ↓
        Ghost Preview Render
               ↓
   Deterministic Placement Validator
               ↓
      Existing Guard / Compiler
               ↓
       Existing Editor Runtime
               ↓
 CommandManager / Operation Log / Undo
```

---

# 1. 범위

## 포함

```text
SpatialPlacementQuery planner contract
Strict runtime schema validation
SpatialSceneSnapshot adapter
Canonical coordinate space
Hard/Soft/Ignore protection policy

PlacementProfile
MeasuredDraft / footprint
Anchor reuse through Stage 3.5 Grounding

Rect-based SpatialOccupancyIndex
Anchor-relative candidate generation
Page/region candidate generation
Coarse free-space fallback
Preferred/compact size policy
Hard constraint filtering
Candidate dedupe / dominance / diversity
Deterministic confidence gate

Global screenshot
Local high-resolution crop
Candidate mark overlay
Compact multimodal request
Strict S* | NONE response
Fake and production provider boundary
Ambiguous-only single call

Ghost preview/scratch render
Actual render bounds validation
Stale scene guard
Existing capability compiler/runtime integration
Operation log / Undo / idempotency
Diagnostics / evaluation
```

## 제외

```text
새 Table/Graph/Math renderer 또는 편집 capability 자체
새 OCR / YOLO / GUI parser
스크린샷에서 geometry 재추출
VLM 자유 좌표 생성
다중 Agent
ReAct tool loop
무한 visual refinement
문서 전체 자동 레이아웃 최적화
다중 페이지 global optimization
새 Editor Runtime / Undo Stack
PDF source mutation
Gaze 입력
```

---

# 2. 시작 조건 / 브랜치

현재 출발 branch:

```text
feat/stage-3.5-robust-grounding
```

새 branch:

```text
feat/stage-4-multimodal-spatial-placement
```

생성 전 반드시:

```text
현재 branch / HEAD / git status 확인
AGENTS.md 확인
Stage 3.5 DECISIONS/SPEC/CHECKLIST/STATUS 재독
Stage 3.5 실제 완료 commit과 테스트 확인
Stage 3.5 관련 미커밋 변경을 현재 branch에서 정리
working tree clean 확인
```

금지:

```text
git reset --hard
git clean
무단 git stash
Stage 3.5 변경을 Stage 4 commit에 섞기
확인 없이 develop에서 새 branch 생성
무단 merge/cherry-pick
```

Stage 3.5 final commit에서 직접 새 branch를 만든다.

```bash
git switch -c feat/stage-4-multimodal-spatial-placement
```

단, 실제 branch가 이미 존재하면 중복 생성하지 않고 상태를 확인한다.

---

# 3. Source of Truth와 dependency

Stage 4:

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
Stage 1 Scene/Semantic task docs
Stage 2 Voice Turn task docs
Editor Core / persistence 관련 docs
```

문서보다 저장소의 실제 타입/API가 우선 필요한 경우,
기존 타입을 재사용하고 문서를 실제 구조에 맞게 최소 수정한다.

---

# 4. 권장 모듈 경계

실제 repo 구조를 우선한다. 개념적 경계:

```text
voice-or-command feature
├─ domain/
│  ├─ spatial-placement-query.ts
│  ├─ placement-profile.ts
│  ├─ measured-draft.ts
│  ├─ placement-candidate.ts
│  └─ spatial-placement-result.ts
│
├─ application/
│  ├─ spatial-scene-source.ts
│  ├─ grounding-orchestrator.ts
│  ├─ spatial-placement-resolver.ts
│  ├─ placement-candidate-generator.ts
│  ├─ placement-confidence-gate.ts
│  ├─ multimodal-observation-builder.ts
│  └─ placement-preview-validator.ts
│
└─ providers/
   ├─ multimodal-placement-judge-provider.ts
   └─ fake-multimodal-placement-judge-provider.ts

editor/scene shared layer
├─ spatial-scene-snapshot adapter
├─ spatial-occupancy-index
├─ draft measurement adapter
├─ scratch/ghost preview renderer
└─ candidate mark renderer
```

규칙:

```text
PDF parsing을 voice feature에 복제하지 않음
Scene object model을 새로 만들지 않음
Rect/PageId/SceneRevision 타입 재사용
AI provider/server boundary 재사용
Editor compiler/runtime 재사용
```

---

# 5. Planner contract

## 5.1 SpatialReferenceQuery

개념 타입:

```ts
type SpatialReferenceQuery =
  | {
      kind: "TARGET";
      query: TargetQuery;
    }
  | {
      kind: "FOCUS";
    }
  | {
      kind: "PAGE";
    }
  | {
      kind: "VIEWPORT";
    };
```

`TARGET`은 실제 ID가 아니라 Stage 3.5가 이해하는 선언적 `TargetQuery`다.

## 5.2 SpatialPlacementQuery

```ts
type SpatialPlacementQuery = {
  reference: SpatialReferenceQuery;

  relation:
    | "AT"
    | "INSIDE"
    | "ABOVE"
    | "BELOW"
    | "LEFT_OF"
    | "RIGHT_OF"
    | "NEAR"
    | "FREE_SPACE";

  regionHint?:
    | "TOP"
    | "BOTTOM"
    | "LEFT"
    | "RIGHT"
    | "MARGIN"
    | "CURRENT_VIEW";

  alignment?: "START" | "CENTER" | "END" | "AUTO";

  distance?: "NEAR" | "NORMAL";

  overlayIntent?: "NONE" | "EXPLICIT";
};
```

실제 repo의 naming convention이 다르면 기존 contract에 맞춘다.

## 5.3 CommandPlan 연결

개념적으로:

```ts
type CommandPlan = {
  // existing fields
  capability: Capability;
  operation: Operation;
  payload: unknown;

  targetQuery?: TargetQuery;
  placementQuery?: SpatialPlacementQuery;
};
```

의미:

```text
create
→ targetQuery 없음 가능
→ placementQuery가 destination을 표현

move/reposition
→ targetQuery가 subject
→ placementQuery가 destination/reference를 표현

기존 direct command
→ placementQuery 없음
→ 기존 Stage 3/3.5 route 그대로
```

## 5.4 strict validation

다음 field가 planner output에 있으면 reject:

```text
x
y
left
top
right
bottom
width
height
bounds
rect
objectId
candidateId
tokenId
pagePixel
viewportPixel
```

기존 schema validator 패턴을 재사용한다.

---

# 6. SpatialSceneSnapshot

개념 타입:

```ts
type SpatialSceneSnapshot = {
  snapshotId: string;
  pageId: PageId;
  sceneRevision: SceneRevision;

  mode: "PDF" | "BLANK";

  coordinateSpace: {
    kind: "PAGE_CANONICAL";
    rotation: number;
  };

  pageBounds: Rect;
  editableBounds: Rect;
  viewportBounds: Rect;

  focus?: {
    bounds?: Rect;
    point?: Point;
    source:
      | "SELECTION"
      | "POINTER"
      | "VOICE_FROZEN_CONTEXT"
      | "HISTORY";
  };

  objects: SpatialSceneObject[];
};
```

개념 객체:

```ts
type SpatialSceneObject = {
  id: SceneObjectId;
  kind: string;

  bounds: Rect;
  renderBounds: Rect;

  sourceLayer:
    | "PDF_BASE"
    | "ANNOTATION"
    | "CANVAS";

  semanticRole?:
    | "TEXT"
    | "FIGURE"
    | "TABLE"
    | "FORMULA"
    | "HANDWRITING"
    | "GRAPH"
    | "NOTE"
    | "OTHER";

  protection: "HARD" | "SOFT" | "IGNORE";

  readingOrder?: number;
  zIndex?: number;
  textPreview?: string;
};
```

실제 Scene/Semantic 타입이 이미 정보를 제공하면 adapter/view만 만든다.

금지:

```text
가짜 object ID
가짜 bounds
PDF.js viewport pixel을 canonical page coordinate로 오인
zoom/DPR이 섞인 geometry
```

---

# 7. Protection policy

기본:

```text
PDF base text/figure/table/formula
→ HARD

Canvas/editor editable object
→ HARD

Underline/highlight/selection/guide
→ SOFT 또는 IGNORE
```

`overlayIntent = EXPLICIT`인 경우에도 capability policy와 Guard가 허용해야 한다.

Protection classification은 한 곳에서 중앙 관리한다.

---

# 8. PlacementProfile과 MeasuredDraft

개념 타입:

```ts
type PlacementProfile = {
  preferredSize: Size;
  minSize: Size;
  maxSize?: Size;

  aspectRatio?: number;

  resizePolicy:
    | "FIXED"
    | "COMPACT_ONCE"
    | "FLEX_WITHIN_BOUNDS";

  minClearance: number;

  allowedRelations: SpatialPlacementQuery["relation"][];

  overlayPolicy:
    | "NEVER"
    | "EXPLICIT_ONLY"
    | "ALLOWED";

  overflowPolicy:
    | "FAIL"
    | "EXPAND_CANVAS_IF_SUPPORTED"
    | "NEW_PAGE_IF_SUPPORTED";
};
```

개념 측정 결과:

```ts
type MeasuredDraft = {
  draftKey: string;
  capability: string;
  kind: string;

  preferredFootprint: Size;
  compactFootprint?: Size;

  contentSummary?: string;
  measurementSource:
    | "RENDERER"
    | "EXISTING_OBJECT"
    | "PROFILE_FALLBACK";
};
```

우선순위:

```text
기존 renderer 측정
> 기존 object actual render bounds
> 중앙 profile fallback
```

Spatial Resolver 내부 capability switch는 금지한다.

---

# 9. Anchor와 Subject Grounding

## 9.1 Anchor

```text
reference.kind = TARGET
→ 기존 Target Grounding Router 재사용

reference.kind = FOCUS
→ frozen focus 사용

reference.kind = PAGE
→ page/editable bounds

reference.kind = VIEWPORT
→ frozen viewport bounds
```

Anchor result 최소:

```ts
type ResolvedSpatialAnchor = {
  kind: "OBJECT" | "FOCUS" | "PAGE" | "VIEWPORT";
  bounds: Rect;
  semanticRole?: string;
  textPreview?: string;
  sourceTarget?: ResolvedTarget;
};
```

## 9.2 Subject

새 객체 생성:

```text
subject 없음
MeasuredDraft 사용
```

이동/재배치:

```text
existing targetQuery resolve
existing object renderBounds를 draft footprint로 사용
```

기존 runtime이 이동을 지원하지 않으면 `UNSUPPORTED`다.

---

# 10. SpatialOccupancyIndex

초기 구현은 exact Rect geometry 기반이다.

최소 API:

```ts
interface SpatialOccupancyIndex {
  intersectsHard(bounds: Rect): boolean;
  hardOverlapArea(bounds: Rect): number;
  softOverlapArea(bounds: Rect): number;
  clearance(bounds: Rect): number;
  nearby(bounds: Rect, limit: number): SpatialSceneObject[];
}
```

구성:

```text
HARD objects
SOFT objects
editable bounds
profile clearance로 inflate한 bounds
```

성능이 실제 병목일 때만 grid/raster implementation을 같은 interface 뒤에 추가한다.

---

# 11. Candidate generation

## 11.1 Candidate type

```ts
type PlacementCandidate = {
  internalId: string;
  alias: `S${number}`;

  sceneRevision: SceneRevision;
  bounds: Rect;

  strategy:
    | "ANCHOR_RELATIVE"
    | "REGION_SLOT"
    | "FREE_SPACE"
    | "OVERFLOW";

  relation: SpatialPlacementQuery["relation"];
  alignment: "START" | "CENTER" | "END" | "AUTO";

  sizeVariant: "PREFERRED" | "COMPACT";

  evidence: {
    hardOverlapArea: number;
    softOverlapArea: number;
    clearance: number;
    anchorDistance: number;
    relationSatisfied: boolean;
    alignmentSatisfied: boolean;
    preferredSizePreserved: boolean;
  };
};
```

VLM에는 `internalId`를 보내지 않는다.

## 11.2 Anchor-relative slots

예:

```text
BELOW
→ left/start aligned
→ center aligned
→ right/end aligned

RIGHT_OF
→ top/start aligned
→ center aligned
→ bottom/end aligned
```

초기 slot이 충돌하면 relation 방향으로 bounded step search를 한다.

무한 scan은 금지한다.

## 11.3 Region slots

Anchor가 없거나 regionHint가 명시된 경우:

```text
TOP
BOTTOM
LEFT
RIGHT
MARGIN
CURRENT_VIEW
```

의 정해진 대표 위치를 만든다.

## 11.4 Free-space fallback

실행 조건:

```text
relation = FREE_SPACE
또는
anchor-relative/region candidate가 없음
```

현재 editable region 안에서 coarse deterministic seeds를 평가한다.

```text
page/viewport corners
edge-aligned positions
object gap positions
coarse grid positions
```

후보는 nearby object edge에 snap할 수 있다.

## 11.5 Size variants

```text
preferred footprint 먼저
후보가 없고 resizePolicy가 허용할 때만 compact footprint 한 번
```

---

# 12. Candidate filter / prune / rank

## 12.1 Hard filter

다음이면 제거:

```text
editable bounds 밖
hard overlap > 0
minimum size 미달
relation 불가능
overlay policy 위반
stale revision
```

## 12.2 Dedupe

같은 위치/공간을 의미하는 near-duplicate 후보를 제거한다.

실제 threshold는 중앙 config로 관리한다.

## 12.3 Dominance

A가 B보다 다음 항목에서 모두 나쁘지 않고 하나 이상 좋으면 B 제거:

```text
relation
preferred size
alignment
clearance
anchor distance
soft overlap
```

## 12.4 Diversity

최종 후보 최대 6개.

동일 strategy/alignment 후보가 목록을 독점하지 않게 대표만 유지한다.

## 12.5 Gate

```text
0 candidates
→ NO_FEASIBLE_PLACEMENT

1 candidate
→ RESOLVED / DETERMINISTIC

2+ candidates + dominant Top-1
→ RESOLVED / DETERMINISTIC

2+ candidates + no dominance
→ AMBIGUOUS
```

초기에는 opaque score threshold를 필수로 하지 않는다.

---

# 13. Multimodal observation

## 13.1 이미지

MVP 입력:

```text
Global Overview
= 현재 page/canvas 전체 축소본
= composed PDF + annotations + canvas

Local Candidate Crop
= anchor와 모든 최종 후보가 보이는 crop
= S1...Sn mark
= draft footprint와 유사한 outline/placeholder
```

후보 alias가 겹치지 않도록 mark layout을 deterministic하게 처리한다.

Screenshot pixel은 실행 geometry가 아니다.

## 13.2 구조화 metadata

예:

```json
{
  "instruction": "이 그림 아래 빈 공간에 설명 메모를 추가해",
  "draft": {
    "kind": "NOTE",
    "contentSummary": "그림 설명",
    "size": "PREFERRED"
  },
  "anchor": {
    "kind": "FIGURE",
    "textSummary": "Transformer architecture diagram"
  },
  "candidates": [
    {
      "alias": "S1",
      "relation": "BELOW",
      "alignment": "START",
      "fit": "PREFERRED",
      "clearance": "HIGH",
      "softOverlap": "NONE"
    }
  ]
}
```

원칙:

```text
전체 Scene JSON 전송 금지
전체 PDF text 전송 금지
실제 object ID 전송 최소화/금지
raw coordinates 전송 불필요
```

---

# 14. MultimodalPlacementJudgeProvider

계약 예:

```ts
interface MultimodalPlacementJudgeProvider {
  judge(
    request: MultimodalPlacementRequest,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<MultimodalPlacementChoice>;
}
```

결과:

```ts
type MultimodalPlacementChoice = {
  choice: `S${number}` | "NONE";
};
```

runtime validation:

```text
strict object
unknown field reject
현재 request alias만 accept
stale request reject
coordinate field reject
```

호출 정책:

```text
AMBIGUOUS에서만
turn당 최대 1회
unit test는 Fake Provider
provider error/NONE → no commit
```

---

# 15. Ghost preview와 validator

## 15.1 Preview

```text
persistent Scene에 쓰지 않는 scratch layer
실제 renderer/component 사용
actual render bounds 반환
```

개념 계약:

```ts
interface PlacementPreviewRenderer {
  render(input: {
    draft: MeasuredDraft;
    candidate: PlacementCandidate;
    snapshot: SpatialSceneSnapshot;
  }): Promise<PlacementPreview>;
}
```

## 15.2 Validation

```ts
type PlacementValidationResult =
  | {
      status: "VALID";
      actualBounds: Rect;
    }
  | {
      status: "INVALID";
      reason:
        | "OUT_OF_BOUNDS"
        | "HARD_OVERLAP"
        | "MIN_SIZE"
        | "RELATION_BROKEN"
        | "OVERLAY_POLICY"
        | "STALE_SCENE"
        | "RENDER_MISMATCH";
    };
```

최소 검사:

```text
actual bounds inside editable bounds
hard overlap 없음
minimum size
requested relation
overlay policy
scene revision
draft/candidate/preview identity
```

invalid 처리:

```text
기존 안전 후보 중 다음 후보 최대 1회
추가 VLM 호출 없음
실패하면 no commit
```

---

# 16. Result contract

```ts
type SpatialPlacementResult =
  | {
      status: "RESOLVED";
      source: "DETERMINISTIC" | "MULTIMODAL";
      placement: ResolvedPlacement;
    }
  | {
      status: "AMBIGUOUS";
      candidates: PlacementCandidate[];
    }
  | {
      status:
        | "NO_FEASIBLE_PLACEMENT"
        | "ANCHOR_NOT_FOUND"
        | "UNSUPPORTED"
        | "STALE_SCENE"
        | "PROVIDER_UNAVAILABLE"
        | "PROVIDER_ERROR"
        | "INVALID_PROVIDER_CHOICE"
        | "PREVIEW_INVALID"
        | "CANCELLED";
    };
```

`AMBIGUOUS`는 application orchestrator 내부 상태이며,
provider까지 실패한 뒤 자동 commit으로 승격하지 않는다.

---

# 17. Existing runtime integration

Planner routing:

```text
placementQuery 없음
→ 기존 Direct Route

placementQuery 있음
→ Spatial Placement Route
```

Spatial route:

```text
Anchor/Subject resolve
→ Placement resolve
→ Preview validate
→ Existing Guard
→ Existing Capability Compiler
→ Existing Editor Runtime
```

Commit 불변식:

```text
turnId exactly once
one logical operation
Undo one step
no mutation on failure
PDF source immutable
```

Stage 3.5 target resolution은 그대로 사용한다.

---

# 18. Diagnostics

최소 기록:

```text
turnId
pageId
sceneRevision
snapshotId
placement route selected
anchor resolution status
candidate generation count
hard-filtered count
final candidate count
deterministic vs multimodal
multimodal call count
provider result
preview result
final result/error
total placement latency
candidate generation latency
multimodal latency
preview latency
commit latency
```

개인정보/문서 원문 전체를 로그에 저장하지 않는다.

---

# 19. 성능/복잡도 불변식

MVP:

```text
deterministic path VLM call = 0
ambiguous path VLM call <= 1
final candidates <= 6
preview retry <= 1
현재 page/canvas만 관찰
자율 loop 없음
```

Rect collision은 current page object 수를 기준으로 충분히 단순하게 시작한다.

성능 문제가 측정되기 전 복잡한 index/worker/GPU 최적화를 하지 않는다.

---

# 20. 테스트 fixture

최소 fixture:

```text
PDF single-column with right margin
PDF dense page with no free space
PDF figure + space below
PDF two-column page
PDF multi-line text + margin note area
Blank canvas sparse objects
Blank canvas dense objects
Duplicate visually plausible spaces
Stale scene revision
Provider NONE / invalid alias / error
Actual preview size drift
```

명령 예:

```text
"이 그림 아래에 메모 추가해"
"이 문단 오른쪽 여백에 메모해"
"오른쪽 빈 공간에 표를 만들어"
"여기 옆에 그래프를 놓아"
"내용 안 가리게 빈 곳에 메모해"
```

새 table/graph capability가 없으면 Fake draft 또는 기존 note/text capability로 placement를 검증한다.

---

# 21. 완료 기준

Stage 4 COMPLETE:

```text
Spatial command가 더 이상 무조건 DEFER_SPATIAL로 끝나지 않음

기존 Stage 3.5 Target Grounding으로 Anchor를 찾음

구조화 Scene geometry에서 실제 안전 후보 생성

명확한 fixture
→ deterministic RESOLVED
→ multimodal call 0

진짜 애매한 fixture
→ multimodal call 정확히 1
→ current S* 또는 NONE만 허용

VLM coordinate generation 불가

Ghost preview 전 persistent mutation 0

stale/invalid/no-space/provider failure
→ no commit

성공
→ existing runtime
→ one operation
→ Undo one step

Stage 2/3/3.5 regression PASS
Editor Core regression PASS
typecheck/lint/git diff --check 기록
STATUS COMPLETE
```

---

# 22. Stage 4 UX Hardening — Natural Text Placement Defaults

## 22.1 Planner Draft / Effective Plan

same-origin/server planner boundary는 `text.create`의 유효한 content와 누락된
`placementQuery`를 draft로 반환할 수 있다. application planning pipeline은 다음 순서로
이를 실행 가능한 strict plan으로 만든다.

```text
Planner call exactly once
→ parseDirectPlannerDraftResult
→ extractSpatialPhraseEvidence
→ normalizeTextPlacementIntent
→ parseDirectPlannerResult
→ existing guard/spatial execution
```

따라서 recoverable omission은 HTTP 502가 아니며, upstream transport failure와 malformed
output만 기존 provider error contract를 따른다.

## 22.2 Placement mode

```text
"왼쪽 위에 가나다라라고 써 줘"
→ PAGE / FREE_SPACE / TOP / START
→ EXPLICIT_REGION

"가나다라라고 써 줘"
→ AUTO_FLOW
→ FOCUS, trusted last text, PAGE TOP/START 순서

"빈 공간에 가나다라라고 써 줘"
→ PAGE / FREE_SPACE / AUTO
→ AUTO_FREE_SPACE

"위에 가나다라라고 써 줘"
→ Focus가 있으면 ABOVE FOCUS
→ 없고 deictic이 아니면 PAGE / TOP / START

"그 위에 가나다라라고 써 줘"
→ Focus/history가 없으면 semantic TARGET query 유지
→ typed no-commit
```

현재 repository에는 frozen caret/insertion point와 일반 default용 canonical viewport
writing origin이 없다. 따라서 AUTO_FLOW production 우선순위는 실제 지원되는
FOCUS → trusted current-page last text → PAGE origin이다.

## 22.3 Phrase evidence와 content 보호

한국어 horizontal/vertical, page/view scope, free-space delegation, deictic/object reference를
작은 compositional grammar로 조합한다. Planner payload의 exact content span을 먼저 mask하여
`"왼쪽 위라고 써 줘"`, `"빈 공간이라고 써 줘"`의 content를 placement로 오인하지 않는다.

## 22.4 Choice policy와 safety

EXPLICIT_REGION과 AUTO_FLOW의 layout-only tie는 Phase B stable order에서 선택하며
screenshot/VLM을 호출하지 않는다. AUTO_FREE_SPACE는 provider가 있으면 기존 Phase C를
최대 한 번 사용하고, provider unavailable일 때만 safe shortlist stable fallback을 쓴다.

```text
additional planner calls = 0
candidate geometry generation = Phase B only
Preview/Validation bypass = 0
failure side effects = 0
```
