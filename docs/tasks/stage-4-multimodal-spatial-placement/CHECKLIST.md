# Stage 4 — Candidate-Constrained Multimodal Spatial Placement: CHECKLIST

## 사용법

- `[ ]` 미완료
- `[x]` 완료
- 실제 완료된 항목만 체크한다.
- commit/test/known issue는 `STATUS.md`에 기록한다.
- 체크 순서는 구현 순서를 의미한다.
- 한 세션에서 다음 Phase를 선행 구현하지 않는다.

---

# Phase 0. Stage 3.5 Handoff / Branch / Existing Architecture

## 0.1 Git 상태

- [x] 현재 branch가 `feat/stage-3.5-robust-grounding`인지 확인
- [x] current HEAD / 최근 log 기록
- [x] `git status --short` 기록
- [x] `AGENTS.md` 재독
- [x] Stage 3.5 `DECISIONS.md` 재독
- [x] Stage 3.5 `SPEC.md` 재독
- [x] Stage 3.5 `CHECKLIST.md` 실제 완료 상태 확인
- [x] Stage 3.5 `STATUS.md` 실제 완료 상태 확인
- [x] Stage 3.5 handoff test/typecheck 재검증
- [x] 현재 미커밋 변경이 Stage 3.5 관련인지 파일별 확인
- [x] Stage 3.5 관련 변경은 현재 branch에서 완료/커밋
- [x] unrelated 변경이 있으면 손대지 않고 명시
- [x] `reset --hard`, `clean`, 무단 `stash`를 사용하지 않음
- [x] Stage 3.5 final commit 기록
- [x] working tree clean 확인
- [x] `feat/stage-4-multimodal-spatial-placement` 생성
- [x] Stage 4 base/start HEAD 기록

## 0.2 Existing Planner / Grounding

- [x] `CommandPlan` 실제 타입/validator 경로 확인
- [x] 기존 `DEFER_SPATIAL` contract와 routing 확인
- [x] `TargetQuery` 실제 union 확인
- [x] Target Grounding Router 실제 경로 확인
- [x] Relative/TextSpan/SemanticUnit/Object resolver 경로 확인
- [x] Grounded LLM Recovery와 provider pattern 확인
- [x] Frozen context / sceneRevision 사용 위치 확인
- [x] Guard / idempotency 사용 위치 확인

## 0.3 Existing Scene / Geometry

- [x] PDF canonical page bounds source 확인
- [x] PDF semantic object bounds source 확인
- [x] Canvas object bounds/renderBounds source 확인
- [x] Annotation bounds source 확인
- [x] zoom / DPR / rotation transform source 확인
- [x] current viewport bounds source 확인
- [x] focus/selection/pointer source 확인
- [x] Scene object layer/z-index/editability metadata 확인
- [x] screenshot/composed canvas capture API 확인
- [x] existing spatial index/collision utility 검색
- [x] existing debug overlay pattern 확인

## 0.4 Existing Editor / Renderer

- [x] capability registry 실제 경로 확인
- [x] object size/measurement API 확인
- [x] preview/scratch/ghost layer 지원 여부 확인
- [x] create/move operation API 확인
- [x] compiler/runtime 경로 확인
- [x] CommandManager / Operation Log / Undo 경로 확인
- [x] IndexedDB persistence commit boundary 확인
- [x] existing AI server/provider boundary 확인

완료 조건:

```text
Stage 3.5 변경이 Stage 4에 섞이지 않은 clean base가 있고,
Stage 4가 재사용해야 할 실제 Planner/Grounding/Scene/Editor API 목록이
STATUS.md에 기록되어 있어야 한다.
```

---

# Phase A. Spatial Contract / Frozen Spatial Scene Foundation

## A1. Planner Contract

- [x] `SpatialReferenceQuery` 정의
- [x] `SpatialPlacementQuery` 정의
- [x] existing `CommandPlan`에 optional `placementQuery` 최소 확장
- [x] create subject 없음 / placement 있음 contract
- [x] move subject target / placement destination contract
- [x] relation union 정의
- [x] regionHint/alignment/distance 정의
- [x] explicit overlay intent contract 정의
- [x] existing direct plan compatibility 유지
- [x] `DEFER_SPATIAL` migration/backward compatibility 결정

## A2. Strict Validation

- [x] valid spatial plan accept
- [x] valid nested TargetQuery reference accept
- [x] unknown relation reject
- [x] unknown field reject
- [x] x/y reject
- [x] width/height reject
- [x] bounds/rect reject
- [x] arbitrary objectId reject
- [x] arbitrary candidateId reject
- [x] prototype pollution / malformed payload 방어
- [x] `JSON.parse(...) as Type`만으로 신뢰하지 않음

## A3. Domain Contracts

- [x] `PlacementProfile`
- [x] `MeasuredDraft`
- [x] `SpatialSceneSnapshot`
- [x] `SpatialSceneObject`
- [x] protection policy type
- [x] `ResolvedSpatialAnchor`
- [x] `PlacementCandidate`
- [x] `ResolvedPlacement`
- [x] `SpatialPlacementResult`
- [x] error/reason union
- [x] 기존 PageId/SceneRevision/Rect/Point 타입 재사용

## A4. Spatial Scene Source

- [x] `SpatialSceneSource` interface
- [x] actual Scene/Semantic adapter
- [x] pageId/sceneRevision 고정
- [x] canonical coordinate space 고정
- [x] page/editable/viewport bounds
- [x] frozen focus/selection 연결
- [x] PDF base objects 수집
- [x] Annotation objects 수집
- [x] Canvas objects 수집
- [x] renderBounds 우선순위
- [x] protection classification 중앙화
- [x] stale snapshot detection
- [x] FakeSpatialSceneSource

## A5. Placement Profile / Measurement Boundary

- [x] `PlacementProfileProvider` 또는 기존 capability registry adapter
- [x] `DraftMeasurementProvider` contract
- [x] resolver 내부 capability-specific switch 금지
- [x] preferred/min/compact size contract
- [x] existing object reposition footprint contract
- [x] unsupported capability result

## A6. Phase A Tests

- [x] planner valid spatial query
- [x] planner forbidden coordinate fields
- [x] direct plan regression
- [x] PDF snapshot mapping
- [x] Blank Canvas snapshot mapping
- [x] zoom/DPR independent canonical geometry
- [x] sceneRevision freeze
- [x] protection classification
- [x] fake scene/profile/measurement provider
- [x] Stage 3.5 Grounding regression
- [x] targeted typecheck
- [x] targeted lint
- [x] `git diff --check`
- [x] Phase A STATUS 갱신
- [x] Phase A implementation/docs commit 기록

완료 조건:

```text
LLM/network/스크린샷 없이
typed spatial plan
→ frozen SpatialSceneSnapshot
→ generic profile/measurement contract
까지 테스트할 수 있어야 한다.
```

---

# Phase B. Deterministic Placement Candidate Engine

## B1. Grounding Orchestrator

- [ ] placement route와 direct route 분리
- [ ] anchor `TARGET` → Stage 3.5 Grounder 재사용
- [ ] anchor `FOCUS` → frozen focus
- [ ] anchor `PAGE` → page/editable bounds
- [ ] anchor `VIEWPORT` → frozen viewport
- [ ] create subject 없음 처리
- [ ] move subject grounding
- [ ] anchor not found
- [ ] subject unsupported
- [ ] no duplicate Grounder implementation

## B2. SpatialOccupancyIndex

- [ ] HARD/SOFT/IGNORE 분리
- [ ] profile clearance inflate
- [ ] editable bounds 검사
- [ ] hard overlap area
- [ ] soft overlap area
- [ ] nearest clearance
- [ ] nearby objects
- [ ] exact Rect geometry 기반 MVP
- [ ] raster/CV 불필요
- [ ] unit tests

## B3. Anchor-relative Slots

- [ ] ABOVE start/center/end
- [ ] BELOW start/center/end
- [ ] LEFT_OF start/center/end
- [ ] RIGHT_OF start/center/end
- [ ] INSIDE/AT explicit overlay policy
- [ ] NEAR representative slots
- [ ] bounded directional step search
- [ ] page bounds clamp가 아니라 invalid reject 우선
- [ ] requested relation 보존

## B4. Region / Free-space Candidate

- [ ] TOP/BOTTOM/LEFT/RIGHT
- [ ] MARGIN
- [ ] CURRENT_VIEW
- [ ] page/viewport corner seeds
- [ ] object gap seeds
- [ ] coarse grid fallback
- [ ] nearby edge snap
- [ ] preferred size first
- [ ] compact size 최대 한 번
- [ ] overflow/new page는 actual capability가 있을 때만 candidate

## B5. Filter / Prune / Gate

- [ ] hard constraint filter
- [ ] min size filter
- [ ] overlay policy filter
- [ ] relation validation
- [ ] near-duplicate dedupe
- [ ] dominance pruning
- [ ] strategy diversity
- [ ] final candidates <= 6
- [ ] 0 → NO_FEASIBLE_PLACEMENT
- [ ] 1 → deterministic RESOLVED
- [ ] dominant top1 → deterministic RESOLVED
- [ ] genuine ambiguity → AMBIGUOUS
- [ ] opaque weighted score 없이 설명 가능한 evidence

## B6. Debug / Diagnostics

- [ ] S1...Sn overlay
- [ ] candidate JSON
- [ ] filtered reason
- [ ] deterministic/ambiguous reason
- [ ] hard/soft obstacle debug
- [ ] canonical coordinate display
- [ ] no production mutation

## B7. Phase B Tests

- [ ] figure below unique space
- [ ] paragraph right margin
- [ ] dense page no feasible
- [ ] two-column page
- [ ] blank canvas sparse
- [ ] blank canvas dense
- [ ] preferred vs compact
- [ ] duplicate candidates
- [ ] dominance
- [ ] true ambiguity
- [ ] candidate cap 6
- [ ] deterministic path future VLM call 0 contract
- [ ] Stage 3.5 regression
- [ ] typecheck/lint/diff-check
- [ ] Phase B STATUS/commits

완료 조건:

```text
실제 Frozen Scene geometry만으로
안전한 S1...Sn을 만들고,
명확한 경우 VLM 없이 하나를 resolve할 수 있어야 한다.
```

---

# Phase C. Bounded Multimodal Placement Judge

## C1. Observation Builder

- [ ] composed page/canvas screenshot source 재사용
- [ ] global overview 생성
- [ ] anchor/candidates local crop 생성
- [ ] candidate footprint mark
- [ ] alias mark 충돌 방지
- [ ] screenshot pixel과 execution geometry 분리
- [ ] compact draft summary
- [ ] compact anchor summary
- [ ] compact candidate metadata
- [ ] 전체 PDF text 미전송
- [ ] 전체 Scene JSON 미전송
- [ ] actual internal candidate ID 미전송

## C2. Provider Contract

- [ ] `MultimodalPlacementJudgeProvider`
- [ ] `FakeMultimodalPlacementJudgeProvider`
- [ ] AbortSignal
- [ ] timeout/error normalization
- [ ] browser secret 노출 없음
- [ ] existing server/AI provider pattern 재사용
- [ ] unit tests에서 network 호출 없음

## C3. Strict Output

- [ ] `{ choice: "S1" }`
- [ ] `{ choice: "NONE" }`
- [ ] current alias만 accept
- [ ] stale alias reject
- [ ] unknown alias reject
- [ ] unknown field reject
- [ ] coordinate output reject
- [ ] free text reject
- [ ] confidence를 실행 근거로 사용하지 않음

## C4. Invocation Policy

- [ ] AMBIGUOUS에서만 호출
- [ ] deterministic path call 0
- [ ] turn당 call <= 1
- [ ] no candidate일 때 호출하지 않음
- [ ] provider unavailable → no commit
- [ ] provider error → no commit
- [ ] NONE → no commit
- [ ] invalid choice → no commit
- [ ] autonomous retry/tool loop 없음

## C5. Tests

- [ ] unique candidate no call
- [ ] dominant candidate no call
- [ ] ambiguous exactly one call
- [ ] valid S* choice
- [ ] NONE
- [ ] invalid alias
- [ ] stale request
- [ ] provider error
- [ ] screenshot/crop mapping
- [ ] metadata redaction
- [ ] typecheck/lint/diff-check
- [ ] Phase C STATUS/commits

완료 조건:

```text
진짜 ambiguous한 경우에만
현재 실제 후보가 표시된 이미지와 compact metadata를 보고
VLM이 S* 또는 NONE 하나만 선택해야 한다.
```

---

# Phase D. Ghost Preview / Deterministic Validation

## D1. Scratch Preview

- [ ] existing renderer 재사용
- [ ] persistent Scene mutation 없음
- [ ] IndexedDB write 없음
- [ ] Operation Log write 없음
- [ ] Undo history write 없음
- [ ] actual render bounds 반환
- [ ] preview lifecycle cleanup
- [ ] cancellation cleanup

## D2. Validator

- [ ] sceneRevision
- [ ] page/editable bounds
- [ ] actual hard overlap
- [ ] minimum size
- [ ] requested relation
- [ ] overlay policy
- [ ] draft identity
- [ ] candidate identity
- [ ] render mismatch
- [ ] structured invalid reason

## D3. Retry Policy

- [ ] preview invalid 시 no immediate commit
- [ ] 이미 생성된 다음 안전 후보 최대 1회
- [ ] 추가 VLM 호출 없음
- [ ] second invalid → PREVIEW_INVALID
- [ ] infinite loop 없음

## D4. Tests

- [ ] text wrap height drift
- [ ] table/placeholder size drift
- [ ] out of bounds
- [ ] hard overlap after render
- [ ] relation broken
- [ ] stale scene
- [ ] preview cleanup
- [ ] retry 0/1 bound
- [ ] no persistent mutation assertion
- [ ] typecheck/lint/diff-check
- [ ] Phase D STATUS/commits

완료 조건:

```text
선택된 placement를 실제 renderer로 미리 검증하기 전에는
어떤 persistent mutation도 발생하지 않아야 한다.
```

---

# Phase E. Planner / Compiler / Runtime Integration

## E1. Routing

- [ ] placementQuery 없음 → 기존 Direct Route
- [ ] placementQuery 있음 → Spatial Route
- [ ] existing `DEFER_SPATIAL` migration
- [ ] direct command behavior 변경 없음
- [ ] Stage 3.5 Grounder reuse
- [ ] cancel/no-op route

## E2. Compiler / Runtime

- [ ] ResolvedPlacement를 existing capability compiler input으로 연결
- [ ] existing create operation 연결
- [ ] existing move operation은 지원될 때만 연결
- [ ] PDF source mutation 차단
- [ ] one logical operation
- [ ] source turnId 기록
- [ ] duplicate turnId commit 차단
- [ ] commit failure normalize
- [ ] no new runtime/undo stack

## E3. History / Relation

- [ ] last successful spatial operation 기록
- [ ] failed/NONE/stale turn이 history를 덮어쓰지 않음
- [ ] REVISE_LAST compatibility
- [ ] CONTINUE compatibility
- [ ] undo/redo compatibility

## E4. Integration Tests

- [ ] note/text create in unique space
- [ ] anchor-based create
- [ ] free-space create
- [ ] ambiguous multimodal create
- [ ] no feasible → no commit
- [ ] provider NONE → no commit
- [ ] stale → no commit
- [ ] preview invalid → no commit
- [ ] duplicate turn → one commit
- [ ] one operation → one Undo
- [ ] direct underline/highlight regression
- [ ] semantic/text-span grounding regression

완료 조건:

```text
Validated ResolvedPlacement만 기존 Editor Runtime으로 commit되고,
성공은 Undo 한 번, 실패는 side effect 0이어야 한다.
```

---

# Phase F. Diagnostics / Evaluation / Completion

## F1. Diagnostics

- [ ] route selection
- [ ] snapshot/page/revision
- [ ] anchor result
- [ ] generated/filtered/final candidate count
- [ ] deterministic vs multimodal
- [ ] multimodal call count
- [ ] provider result
- [ ] preview result
- [ ] final result/error
- [ ] candidate generation latency
- [ ] multimodal latency
- [ ] preview latency
- [ ] commit latency
- [ ] document raw content logging 최소화

## F2. Evaluation

- [ ] Placement Validity Rate
- [ ] Hard Overlap Rate
- [ ] Relation Satisfaction
- [ ] Preferred Size Preservation
- [ ] Deterministic Resolution Rate
- [ ] Multimodal Fallback Rate
- [ ] Multimodal Choice Accuracy
- [ ] False Commit Rate
- [ ] No-Commit Precision
- [ ] p50/p95 placement latency
- [ ] Undo integrity

## F3. Full Regression

- [ ] Stage 2 Voice Turn
- [ ] Stage 3 Direct Route
- [ ] Stage 3.5 Robust Grounding
- [ ] Editor Core full tests
- [ ] Web full tests
- [ ] typecheck
- [ ] lint
- [ ] `git diff --check`
- [ ] known pre-existing failure 구분
- [ ] unrelated code 변경 없음 확인

## F4. Completion

- [ ] `CHECKLIST.md` 실제 완료 항목만 `[x]`
- [ ] `STATUS.md`에 final commits/test/limitations 기록
- [ ] Stage 4 `Status: COMPLETE`
- [ ] next-stage handoff 기록
- [ ] branch clean 또는 의도된 잔여 변경 명시

Stage 4 완료 정의:

```text
Geometry-first safe candidates
+ deterministic fast path
+ ambiguous-only bounded multimodal choice
+ render-and-validate
+ existing transactional Editor commit
```
