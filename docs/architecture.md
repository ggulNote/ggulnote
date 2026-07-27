# Architecture

## 현재 구조

- React Editor UI
  - Document Viewer
    - PDF.js Adapter
    - Document Session
    - Page Renderer
    - Coordinate Transformer
  - Editor Workspace
    - Document Stage (PDF/Blank layer + interaction layer)
  - Debug/toolbar components
- Editor Core (`packages/editor-core`)
  - Annotation Model
  - Page Scene / Scene Store
  - Command Manager (Undo/Redo)
  - Renderer 인터페이스 (`AnnotationRenderer`)
  - Operation/Serialization
- Gaze Core (`packages/gaze-core`)
  - Landmark Frame / Eye Geometry 타입
  - Raw Gaze Observation / Engine State 타입
  - MediaPipe, DOM, 화면 좌표 계산에 의존하지 않음
- Interaction Core (`packages/interaction-core`)
  - 세션 상대 시간 `InteractionClock`
  - 시간 보관 기반 `RingBuffer`
  - `sourceCapturedAt` 기준 Gaze Timeline
  - 향후 Speech/View State를 별도 Buffer로 확장하는 `InteractionTimeline`
- Shared Types (`packages/shared-types`)
  - 정규화 좌표 타입
  - 패키지 공통 branded `SessionTimeMs`

## 향후 구조(다음 단계)

- Local persistence
  - IndexedDB 저장
  - Editor Operation 로그 저장/복원
- Remote sync extension
- MediaPipe Web Adapter와 JEO Raw Gaze Vector 계산 이식
- 동일 Clock을 사용하는 별도 Speech/View State Timeline
- OCR / semantic pipeline

## 역할 분리

- React
  - Toolbar, 개발용 패널, 상태 표시, 엔진 인스턴스 생명주기 관리
  - 뷰어 레이어(기존 PDF/백지 Canvas)와 Overlay Canvas 레이어 통합
- Editor Core
  - `Annotation` 상태, 페이지별 Scene, Command 처리, Undo/Redo, Selection, 히트테스트, 렌더링 계약
  - 직렬화 가능한 Operation 생성
- Gaze Core
  - 프레임과 Raw Gaze 결과의 직렬화 가능한 타입 계약
  - 실제 Landmark 처리와 Vector 계산은 다음 단계에서 Adapter/Engine으로 연결
- Interaction Core
  - 입력 모달리티가 공유할 세션 시간축 제공
  - Gaze 결과를 원본 프레임 촬영 시각으로 보관
  - Gaze, Speech, View State 자료를 서로 다른 Buffer로 유지
- Adapter
  - Native Canvas 2D 렌더러 (`canvas-2d-renderer`)
  - 좌표, 리사이즈, 렌더링 컨텍스트 브릿지

## 코어 원칙

- React state에 Annotation 배열을 직접 보관하지 않음
- Canvas 렌더링은 Editor Core로부터 받은 `Annotation` 모델 기반
- 저장소/API 호출은 별도 Adapter/Service 계층에서 처리 예정
- 현재 단계에서 저장소/동기화 기능은 미구현
