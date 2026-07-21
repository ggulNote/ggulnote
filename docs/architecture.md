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
- Shared Types (`packages/shared-types`)
  - 정규화 좌표 타입

## 향후 구조(다음 단계)

- Local persistence
  - IndexedDB 저장
  - Editor Operation 로그 저장/복원
- Remote sync extension
- Gaze/Voice/Intent integration layer
- OCR / semantic pipeline

## 역할 분리

- React
  - Toolbar, 개발용 패널, 상태 표시, 엔진 인스턴스 생명주기 관리
  - 뷰어 레이어(기존 PDF/백지 Canvas)와 Overlay Canvas 레이어 통합
- Editor Core
  - `Annotation` 상태, 페이지별 Scene, Command 처리, Undo/Redo, Selection, 히트테스트, 렌더링 계약
  - 직렬화 가능한 Operation 생성
- Adapter
  - Native Canvas 2D 렌더러 (`canvas-2d-renderer`)
  - 좌표, 리사이즈, 렌더링 컨텍스트 브릿지

## 코어 원칙

- React state에 Annotation 배열을 직접 보관하지 않음
- Canvas 렌더링은 Editor Core로부터 받은 `Annotation` 모델 기반
- 저장소/API 호출은 별도 Adapter/Service 계층에서 처리 예정
- 현재 단계에서 저장소/동기화 기능은 미구현
