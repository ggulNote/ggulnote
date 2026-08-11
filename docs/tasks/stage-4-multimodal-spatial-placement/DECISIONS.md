# Stage 4 — Candidate-Constrained Multimodal Spatial Placement: DECISIONS

## 0. 문서 목적

이 문서는 Stage 4의 설계 결정(Source of Truth)을 고정한다.

문서 우선순위:

```text
AGENTS.md
> docs/tasks/stage-4-multimodal-spatial-placement/DECISIONS.md
> docs/tasks/stage-4-multimodal-spatial-placement/SPEC.md
> docs/tasks/stage-4-multimodal-spatial-placement/CHECKLIST.md
> docs/tasks/stage-4-multimodal-spatial-placement/STATUS.md
```

Stage 4는 완료된 Stage 3 / 3.5 위에 다음 기능을 추가한다.

```text
기존 Target 또는 Focus를 Anchor로 resolve
→ 실제 Scene geometry에서 안전한 Placement 후보 생성
→ 명확하면 deterministic 선택
→ 진짜 애매한 경우만 bounded multimodal judge 호출
→ 실제 draft를 preview render
→ deterministic validation
→ 기존 Editor Runtime으로 한 번만 commit
```

Stage 4의 핵심 이름은 다음으로 고정한다.

> Candidate-Constrained Multimodal Spatial Placement

---

# D1. Stage 3 / 3.5를 대체하거나 재구현하지 않는다

Stage 3 / 3.5가 이미 소유하는 책임:

```text
CompletedVoiceTurn
Direct Planner
TargetQuery
Target Grounding Router
Relative / TextSpan / SemanticUnit / Object Grounder
Deterministic Confidence Gate
Bounded Text LLM Recovery
ResolvedTarget
Guard
Capability Compiler
Editor Runtime
CommandManager
Operation Log / Undo
Idempotency
```

Stage 4는 위 구조를 유지하고, 공간 배치가 필요한 plan에만 새로운 route를 추가한다.

금지:

```text
Stage 3 Planner 재작성
Stage 3.5 Grounder 재작성
새 Voice Turn 상태 머신
새 Editor Runtime
새 Undo Stack
새 Operation Log
```

---

# D2. Target Grounding과 Spatial Placement를 분리한다

둘은 같은 문제가 아니다.

```text
Target Grounding
= 이미 존재하는 무엇을 찾는가

Spatial Placement
= 새 객체 또는 이동 객체를 어디에 놓는가
```

따라서 최종 경계:

```text
Grounding Orchestrator
├─ Target Grounding Router
│  ├─ RelativeGrounder
│  ├─ TextSpanGrounder
│  ├─ SemanticUnitGrounder
│  └─ ObjectGrounder
│
└─ Spatial Placement Resolver
   ├─ Anchor Resolver Adapter
   ├─ Placement Candidate Generator
   ├─ Deterministic Placement Gate
   ├─ Multimodal Placement Judge
   └─ Preview Validator
```

`SpatialPlacementResolver`를 기존 `TargetGroundingRouter` 내부의 또 다른 Target Grounder로 억지로 넣지 않는다.

예:

```text
"이 그림 아래 표를 만들어"
Anchor Target = 이 그림
Destination Placement = 그림 아래

"이 표를 그림 오른쪽으로 옮겨"
Subject Target = 이 표
Reference Anchor = 그림
Destination Placement = 그림 오른쪽
```

---

# D3. Planner는 의미적 PlacementQuery만 생성한다

Planner가 생성할 수 있는 것:

```text
reference 의미
relation
region hint
alignment
distance hint
명시적 overlay 의도 여부
```

Planner가 생성할 수 없는 것:

```text
x / y
width / height
실제 objectId
실제 candidateId
render bounds
viewport pixel
Editor API 호출
```

기존 `CommandPlan`에는 최소 변경으로 다음을 추가한다.

```text
targetQuery?
placementQuery?
```

의미:

```text
targetQuery
= mutation의 subject 또는 기존 direct target

placementQuery
= destination과 reference anchor에 대한 의미적 질의
```

---

# D4. VLM은 좌표 생성기가 아니라 bounded candidate judge다

채택하지 않음:

```text
Screenshot
→ VLM
→ { x, y, width, height }
```

채택:

```text
Code
→ S1 ... Sn 실제 후보 생성
→ 구조화 metadata + candidate-marked screenshot
→ VLM
→ { choice: "S2" }
```

VLM 권한:

```text
현재 요청에서 코드가 발급한 ephemeral alias S1...Sn 중 하나 선택
또는 NONE
```

VLM 금지:

```text
새 후보 발명
좌표/크기 생성
실제 Scene/Object ID 생성
Editor tool 호출
반복적인 자유 tool loop
```

알 수 없는 alias, stale alias, 후보 목록에 없는 선택은 무효다.

---

# D5. 구조화된 Scene geometry가 authoritative source다

배치의 실제 truth:

```text
PDF Semantic / Region / Line / Word bounds
Canvas object bounds
Annotation bounds
render bounds
page/editable bounds
scene revision
layer / protection metadata
```

Screenshot의 역할:

```text
시각적 균형
문단/그림과의 자연스러운 관계
후보가 실제로 답답해 보이는지
주변 콘텐츠와 시각적으로 연결되는지
```

Screenshot을 다시 OCR하거나 별도 YOLO/GUI parser로 분석해 authoritative geometry를 재생성하지 않는다.

금지:

```text
새 Canvas YOLO
새 OCR pipeline
이미 존재하는 Scene geometry 재추정
스크린샷 픽셀을 실행 좌표로 직접 사용
```

---

# D6. 한 Placement 결정은 하나의 Frozen Spatial Scene에서 끝낸다

모든 단계는 동일한 snapshot을 사용한다.

```text
Planner reference
Anchor resolution
Candidate generation
Multimodal observation
Preview validation
Commit guard
```

필수 식별자:

```text
pageId
sceneRevision
coordinateSpace
snapshotId 또는 동등한 immutable identity
```

현재 scene이 바뀌면 조용히 최신 scene으로 재타겟팅하지 않는다.

```text
STALE_SCENE
→ no commit
```

필요한 경우 사용자의 다음 turn에서 다시 계획한다.

---

# D7. Capability별 차이는 PlacementProfile 뒤에 둔다

`SpatialPlacementResolver` 내부에 다음과 같은 분기를 만들지 않는다.

```text
if table ...
if graph ...
if memo ...
if math ...
```

대신 capability 또는 renderer가 일반화된 `PlacementProfile`과 `MeasuredDraft`를 제공한다.

최소 profile:

```text
preferred size
minimum size
optional aspect ratio
resize policy
minimum clearance
allowed relations
overlay policy
overflow policy
```

실제 크기는 가능한 한 기존 renderer/offscreen measurement에서 얻는다.

임의 상수 크기를 Spatial Resolver에 흩뿌리지 않는다.

---

# D8. 후보 생성은 단순한 geometry-first 알고리즘으로 시작한다

우선순위:

```text
1. Anchor-relative slots
2. Page/region slots
3. Coarse free-space search
4. 지원되는 경우에만 overflow/new-page candidate
```

Anchor-relative 예:

```text
BELOW
→ start / center / end alignment

RIGHT_OF
→ start / center / end alignment
```

충돌 판정은 실제 Rect 기반 `SpatialOccupancyIndex`로 시작한다.

```text
Hard obstacle
Soft obstacle
Editable bounds
Inflated clearance bounds
```

초기부터 별도 segmentation model이나 pixel-level occupancy CV를 만들지 않는다.

Raster occupancy/integral image는 실제 성능 필요가 확인될 때 동일 interface 뒤의 최적화로만 허용한다.

---

# D9. 후보 수와 크기 변형을 제한한다

후보 폭발을 막는다.

```text
최종 후보 최대 6개
preferred size 우선
필요한 경우 compact size 1개만 추가
같은 공간의 near-duplicate는 dedupe
같은 전략의 후보가 목록을 독점하지 않도록 diversity pruning
```

후보는 실제 실행 가능한 geometry만 포함한다.

Hard constraint를 위반하는 후보를 VLM에 보여주지 않는다.

---

# D10. 초기 ranking은 opaque weighted sum보다 lexicographic priority를 사용한다

초기 Stage 4에서 수십 개 가중치를 튜닝하지 않는다.

우선순위:

```text
1. hard constraint 만족
2. 사용자가 명시한 relation 만족
3. preferred size 유지
4. anchor/문단/객체 정렬
5. 충분한 clearance
6. anchor와의 거리
7. soft overlap 최소
```

후보 A가 후보 B보다 모든 상위 기준에서 나쁘지 않고 하나 이상 더 좋으면 A가 B를 dominance한다.

명백한 Top-1이면 VLM을 호출하지 않는다.

---

# D11. Multimodal Judge는 진짜 ambiguity에서 최대 1회만 호출한다

호출 조건:

```text
유효 후보가 2개 이상
+
deterministic dominance로 하나를 고를 수 없음
```

호출하지 않는 경우:

```text
유효 후보 0개
유효 후보 1개
명백한 dominant Top-1
stale scene
unsupported capability
```

입력 이미지 MVP:

```text
1. 현재 Page/Canvas global overview
2. Anchor와 S1...Sn이 보이는 local high-resolution crop
```

입력 metadata:

```text
normalized instruction
draft kind/content summary
anchor semantic summary
candidate별 relation/alignment/fit/clearance category
```

출력:

```json
{ "choice": "S2" }
```

또는:

```json
{ "choice": "NONE" }
```

설명문, 좌표, confidence는 실행 권한으로 사용하지 않는다.

---

# D12. 선택 후 실제 render preview와 deterministic validation을 거친다

선택 결과를 바로 commit하지 않는다.

```text
Selected Candidate
→ scratch/ghost preview render
→ actual render bounds 측정
→ deterministic validation
→ Guard
→ commit
```

Preview는 다음을 변경하지 않는다.

```text
IndexedDB
Operation Log
CommandManager
Undo history
persistent Scene revision
```

검증 최소 항목:

```text
editable bounds 내부
hard overlap 없음
minimum size 충족
relation 유지
명시되지 않은 PDF 원문 overlay 없음
actual render bounds와 candidate footprint 정합
scene revision 일치
```

실패 시:

```text
동일 frozen scene의 이미 생성된 다음 안전 후보를
최대 1회 deterministic retry
```

그마저 실패하면 no commit이다.

무한 self-correction loop는 만들지 않는다.

---

# D13. PDF와 Blank Canvas는 같은 Resolver, 다른 policy를 사용한다

공통 Spatial Placement Resolver를 유지한다.

PDF 기본 policy:

```text
PDF base text/figure/table/formula = HARD
기존 editable object = HARD
underline/highlight/selection overlay = SOFT 또는 IGNORE
명시적 overlay 요청이 아니면 PDF 원문을 덮지 않음
```

Blank Canvas 기본 policy:

```text
기존 canvas object = HARD
selection/guide = SOFT 또는 IGNORE
page/canvas bounds와 snap/alignment metadata 사용
```

명시적 overlay는 다음 두 조건이 모두 있어야 한다.

```text
Planner가 explicit overlay intent를 구조화
+
Capability/Guard가 overlay를 허용
```

---

# D14. 기존 Editor Runtime과 transaction 경계를 유지한다

실제 mutation은 기존 경로로만 수행한다.

```text
ResolvedPlacement
→ Existing Guard
→ Capability Compiler
→ Existing Editor Runtime
→ CommandManager
→ Operation Log
```

불변식:

```text
검증 전 mutation 없음
한 voice turn의 성공 placement = 한 logical operation
Undo 한 번으로 원복
동일 turnId side effect exactly once
실패/NONE/stale/unsupported = no mutation
PDF source immutable
```

---

# D15. Provider와 secret boundary를 분리한다

필수 interface:

```text
MultimodalPlacementJudgeProvider
```

테스트:

```text
FakeMultimodalPlacementJudgeProvider
```

실제 provider:

```text
browser에 secret 노출 금지
server/provider boundary 재사용
AbortSignal 지원
timeout/error normalization
unit test에서 실제 network 호출 금지
```

이미 존재하는 AI provider/server 패턴을 재사용한다.

---

# D16. Gaze는 Stage 4 MVP 입력에 포함하지 않는다

현재 Stage 4가 사용하는 위치 evidence:

```text
Frozen focus
Selection
Pointer/explicit position이 기존 context에 있을 경우
Resolved anchor
Page/Canvas structure
History
```

Gaze는 정확도와 제품 정책이 확정된 뒤 optional evidence source로 추가할 수 있게 interface만 열어둔다.

Gaze가 없다는 이유로 null 분기를 기능 곳곳에 흩뿌리지 않는다.

---

# D17. 실패는 명시적 result로 표현하고 조용히 추측하지 않는다

최소 result/error:

```text
RESOLVED
AMBIGUOUS
NO_FEASIBLE_PLACEMENT
ANCHOR_NOT_FOUND
UNSUPPORTED
STALE_SCENE
PROVIDER_UNAVAILABLE
PROVIDER_ERROR
PREVIEW_INVALID
INVALID_PROVIDER_CHOICE
CANCELLED
```

안전한 fallback이 없는 경우 Top-1을 억지로 commit하지 않는다.

---

# D18. Stage 4 MVP 범위를 제한한다

포함:

```text
SpatialPlacementQuery
Frozen Spatial Scene
Anchor reuse
Geometry candidate generation
Deterministic gate
Bounded multimodal candidate choice
Ghost preview
Deterministic validation
기존 capability/runtime 통합
Diagnostics / tests
```

제외:

```text
새 Table/Graph/Math capability 자체 구현
문서 전체 자동 재배치
다중 페이지 global layout optimization
자율 ReAct/Tool Agent
멀티 Agent debate
RL/RLHF 학습
새 OCR/YOLO
새 Scene model
새 Undo stack/runtime
PDF source mutation
Gaze integration
무한 visual self-reflection
```
