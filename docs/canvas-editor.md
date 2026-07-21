# Canvas Editor Core

## React와 Core 분리

- React는 뷰 렌더, 툴바, 디버그 패널, 키보드 이벤트 바인딩만 담당
- `EditorEngine`은 다음 상태를 소유
  - 현재 문서/페이지
  - 페이지별 Scene
  - 선택 상태
  - Command 스택(Undo/Redo)
  - 마지막 Operation
- Renderer는 Adapter 계층에서 구현
  - `canvas-2d-renderer`가 Native Canvas API로만 렌더

## Annotation 클래스

- `Annotation` 추상 클래스
  - 공통: `id`, `pageId`, `bounds`, `zIndex`, 생성/수정 시각
  - 추상 메서드: `hitTest`, `translate`, `clone`, `serialize`
- 구현 타입
  - `TextAnnotation`
  - `UnderlineAnnotation`
  - `HighlightAnnotation`
  - `ShapeAnnotation`(rectangle / ellipse)
  - `LineAnnotation`(line / arrow)
  - `TableAnnotation`

## Scene 구조

- `SceneStore`
  - 페이지별 `PageScene`을 관리
  - 문서 변경 시 clear
- `PageScene`
  - ID 기반 Map 보관
  - zIndex 정렬 조회
  - Hit Test는 상위(zIndex 높은)부터 검사

## Command Pattern

- 인터페이스: `execute / undo / toOperation`
- 커맨드
  - `CreateAnnotationCommand`
  - `DeleteAnnotationCommand`
  - `MoveAnnotationCommand`
  - `UpdateAnnotationCommand`
- `CommandManager`
  - undoStack / redoStack
  - maxHistory(`DEFAULT_HISTORY_LIMIT = 100`)

## Renderer Adapter

- `AnnotationRenderer`
  - `beginFrame`, `render`, `renderSelection`, `endFrame`
- Core는 Canvas API를 직접 알지 않으며 adapter로만 전달
- 웹은 단일 Overlay Canvas에서:
  - CSS 크기와 DevicePixelRatio 변환 적용
  - 매 frame 전체 clear 후 현재 페이지 annotations 렌더링
  - 선택 대상은 `renderSelection` 호출

## 좌표 및 히트 테스트

- 뷰어는 정규화 좌표를 사용
  - `x,y,width,height`는 0~1로 계산
- 클릭/포인터 위치는 DOM 좌표 -> 정규화 좌표 변환
- Hit test는 normalize 된 좌표에서 tolerance를 페이지 크기에 비례해 계산

## 이동(Drag) 동작

- Select 모드에서 Pointer Down으로 대상 조회 및 선택
- Drag 중에는 `EditorEngine`이 임시 위치로 Scene을 갱신해 미리보기 제공
- Pointer Up 시 이동이 있으면 `MoveAnnotationCommand` 1건 생성
- Cancel 시 시작 snapshot으로 복원

## Undo/Redo

- 커맨드 실행/되돌리기 모두 Operation을 생성
- 새 커맨드 실행 시 Redo stack 초기화
- `editorSnapshot`의 `canUndo/canRedo`로 UI 제어

## 직렬화

- `SerializedAnnotation`(JSON-safe)
  - `schemaVersion`, `id`, `pageId`, `type`, `bounds`, `zIndex`, `properties`, `createdAt`, `updatedAt`
- 역직렬화 단계에서 타입/범위/좌표 유효성 검증

## 제한 사항(현재)

- 크기 조절/Resize 핸들 미지원
- 그룹/Composite 미지원
- 자유 손글씨/원 그리기(커스텀 경로) 미지원
- 저장소 연동 없음(메모리만)
- 시선/음성/LLM 연동 없음

## 다음 단계: IndexedDB 연동 포인트

- Command history의 `EditorOperation`을 영구 저장
- 문서/페이지별 Annotation snapshot 복원
- 마지막 리비전 기준으로 재개 가능한 동기화 레이어 추가 예정
