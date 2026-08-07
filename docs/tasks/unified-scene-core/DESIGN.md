# Scene Core 설계 (1차 통합)

## 목적

PDF 객체(PDF 텍스트/표/이미지/레이아웃 영역)와 Canvas에서 생성된 객체(텍스트/수식/그래프/표/도형/주석/이미지/그룹)를 단일 `SceneSnapshot`으로 통합해, Agent와 배치 엔진이 하나의 읽기 모델을 사용하도록 한다.

본 단계에서는 `SceneCore`가 Source of Truth가 아닌 **Read Model**이며, 기존 Editor/Annotation 상태의 저장/Undo/Redo 계열을 유지한다.

## PDF 모드와 Blank 모드 통합

- 공통 `SceneSnapshot` 구조를 사용한다.
- PDF 모드: PDF 객체 + Canvas 객체 + Annotation 객체를 모두 포함.
- Blank 모드: Canvas 객체 + Annotation(해당 페이지)만 포함.
- mode는 스냅샷/컨텍스트에서만 분기용 태그로 사용한다.

## PDF 객체와 Canvas 객체의 차이

- `source`로 구분
  - `pdf`: 기존 semantic/YOLO/텍스트 아이템 결과를 Adapter로 변환
  - `canvas`: Canvas Object Store에서 직접 생성/수정/삭제되는 객체
- 동일한 `SceneObject` 유니언을 사용하되 `source`와 `kind`로 분기

## Canvas 객체를 CV로 재탐지하지 않는 이유

- 사용자가 생성 시점에 텍스트, 수식, 표, 도형, 주석의 구조 정보가 이미 존재한다.
- 렌더링 이미지/YOLO 재탐지로 구조를 복원하면:
  - 지연(느린 성능), 오탐지, 라운드트립 비용 증가
  - 원본 객체 ID/메타데이터 손실 위험
- 따라서 `CanvasObjectStore`에 구조화 등록 즉시 Scene 객체로 노출한다.

## 손글씨 Stroke 제외 사유

- MVP 범위에서 자유곡선 필기 파이프라인(Stroke, StrokePoint, StrokeGroup)을 운영하지 않는다.
- 화면상 필기 느낌은 필요 시 렌더 스타일 전용으로만 처리할 수 있도록 `text/math/shape/annotation`에 투영한다.

## Canonical Coordinate

- Scene 내부의 모든 좌표는 `pageId` 기준의 페이지 내부 좌표(픽셀 스케일 1)
  - `x`, `y`, `width`, `height`는 페이지 경계 기준.
  - 원점은 좌상단.
  - Zoom/DPR는 Scene bounds 계산에 반영하지 않음.
- 화면/DOM 좌표는 별도 변환기로 변환:
  - `screenPointToPagePoint`
  - `pagePointToScreenPoint`
  - `screenRectToPageRect`
  - `pageRectToScreenRect`
  - `clampRectToPage`
- Bounds는 페이지 내부로 clamp.

## SceneObject Union

`SceneObject`는 공통 필드 + `kind` 기반 discriminated union.

포함 kind:

- `pdf-region`
- `paragraph`, `line`, `word`
- `image`
- `text`
- `math`
- `graph`
- `table`
- `shape`
- `annotation`
- `group`

## Text

`kind: text`, `source: canvas`

- 텍스트 값(`text`), 스타일(`fontFamily`, `fontSize`, `textAlign` 등), 위치/크기/`zIndex`
- 메모/설명 텍스트로 사용.

## Math

`kind: math`, `source: canvas`

- `latex`, `mathJson`, `layout`(display/inline/equation-stack/long-multiplication/long-division)
- 계산 과정은 구조화 가능한 문자열+메타데이터로 보관.

## Graph

`kind: graph`, `source: canvas`

- 식 목록(`expressions`), 뷰포트, 그리드/축 표시 옵션.
- 렌더/파싱은 다음 단계로 이관, 이 단계는 계약 및 등록까지만 수행.

## Table

`kind: table`

- 공통: `rows`, `columns`, `cells`, `rowHeights`, `columnWidths`
- PDF 표(`source: pdf`)와 사용자 표(`source: canvas`)는 구분만 다르다.

## Shape

`kind: shape`

- `rectangle/ellipse/line/arrow/triangle/polygon`
- `geometry`는 기존 도형 모델 형식 재사용을 전제.

## Annotation

`kind: annotation`, `source: canvas`

- `annotationType`: `underline/highlight/strikethrough/box/emphasis`
- `targetObjectIds`를 유지하여 PDF paragraph/line/word 및 canvas object와 연결.
- 배치 계산은 정책에 따라 blocking 제어.

## Group

`kind: group`, `source: canvas`

- `childIds`로 구성.
- bounds는 children union으로 계산.

## Canvas Object Store

- 인터페이스: `create/update/move/resize/visibility/locked/reorder/remove/subscribe`
- immutable update 정책.
- ID/Revision 관리:
  - create/update 삭제/이동/크기조정/표시 상태/zIndex 변경 시 scene revision 증가
  - 동일 값 no-op은 revision 미증가
- 페이지별 조회, 삭제된 객체 제외, 숨김 객체 유지.

## PDF Scene Adapter

- 입력: semantic model + YOLO document regions.
- 출력: `PdfSceneObject[]` (`paragraph/line/word/table/image/pdf-region`)
- 기존 semantic/region 객체를 변환해 객체로 노출하며, 원본 mutation 없음.
- 동일 입력에서 stable ID 유지.

## Canvas Scene Adapter

- 입력: `CanvasObjectStore` + page bounds
- 출력: `CanvasSceneObject[]`
- store 자체를 복제하지 않고 read-only 변환.
- visible=false 객체는 `visible:false`로 유지.

## Scene Revision

- 단조 증가 숫자.
- 조회만으로는 증가하지 않음.
- `sceneRevision` 기준으로 Snapshot 시작/완료 비교하여 stale 판정.

## Occupancy Map

- `blocking` 대상 집계 + 옵션 정책.
- 기본: 텍스트/표/이미지/도형/graph/math/table 등은 기본 blocking.
- Annotation blocking 정책은 타입별로 설정 가능.
- candidate 계산에 필요한 패딩/최소 크기/가시성 정책 반영.

## Free-space Candidate

- 페이지/occupancy 기반 빈 영역 후보 생성.
- PAGE_FREE_SPACE + Focus 상하좌우 후보.
- 후보는 collision, 최소 크기, page 내부, dedup, 정렬 순서를 만족.

## Composite Render Snapshot

- PDF 렌더/Canvas layer를 조합한 최종 시각 결과를 생성하는 계약.
- 실행 전/후 revision 재확인으로 `stale` 계산.
- 렌더러 직접구현 대신 injection 가능한 `renderImage` 형태로 추상화.

## Capability Registry

- `createCapabilityRegistry()`로 독립 인스턴스 생성 가능.
- 중복 ID는 등록 실패.
- `estimateFootprint`, `validatePlacement`, `compile` 인터페이스 제공.
- 실행/커밋은 이번 단계 미구현.

## Placement Contract

- `PlacementRequest`와 `PlacementValidationResult` 사용.
- 검증 항목: revision, candidate 존재, 크기 유효성, page/충돌/최소 크기.
- alignment 기반 resolved bounds 계산.

## Source of Truth / Read Model

- 기존 Editor/Document/Annotation Domain이 Source of Truth를 계속 담당.
- `SceneSnapshot`은 Adapter로 생성되는 read-model.
- 객체를 별도 Scene store로 복제해 보관하지 않음(현재 단계).

## 이번 단계 비범위

- STT/Voice/LLM 연동, 수식 파서·그래프 렌더러·표 편집기 새 구현
- 자동 생성/트랜잭션 commit/rollback
- 실시간 손글씨 인식 및 자유 곡선 입력
- OCR/YOLO 재탐지 기반 캔버스 객체 복원

## 다음 단계 연결 지점

- `buildSceneContext`와 `PlacementValidation` 결과를 기준으로 `Speech Start` 시:
  - Focus 및 sceneRevision 고정
  - Context 선행 생성
  - Capability 실행(Placement 생성/Commit)은 다음 단계에서 연결.
