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
- Gaze Runtime (`apps/web/src/features/gaze`)
  - `FaceTrackingSession`: 카메라 캡처 + MediaPipe worker + 디버그 overlay 플로우
  - `FrameScheduler`: requestVideoFrameCallback/RAF 기반 캡처
  - `WebcamCapture`: getUserMedia 시작/종료 및 에러 분기
  - `GazeWorkerClient`: 단일 처리 in-flight 및 `droppedFrame` 정책 보장
  - `gaze-landmark.worker.ts`: MediaPipe `FaceLandmarker` 추론 및 결과 전달

## 단계별 반영 사항

- 단계 1: 순수 타입/시간축/Timeline 기반 뼈대 구현
  - `SessionTimeMs` 기반 세션 시간축
  - Raw 상태 타입 및 Gaze Timeline의 `sourceCapturedAt` 정렬 정책
- 단계 2: 실제 웹캠 + MediaPipe Face Landmarker 추출
  - 페이지 진입 시 즉시 카메라 권한을 요청하지 않고 버튼 동작 시 `getUserMedia`
  - `requestVideoFrameCallback` 우선 캡처, 미지원 브라우저는 RAF 폴백
  - Web Worker에서 `FaceLandmarker` 추론 수행
  - 결과는 `FaceLandmarkFrame` 형태로 어댑터에서 변환
  - `sourceCapturedAt`은 원본 프레임이 앱으로 들어온 시점(InteractionClock 기준)으로 기록
  - worker inference timestamp는 별도 단조 증가 타임스탬프로 관리

## 향후 구조(다음 단계)

- Local persistence
  - IndexedDB 저장
  - Editor Operation 로그 저장/복원
- Remote sync extension
- JEO Raw Gaze Vector 계산 로직 이식
  - `avg_combined_direction`에 해당하는 단계로 확장
- MediaPipe frame timestamp 지연/처리 성능 측정값과 `sourceCapturedAt` 분리 유지
- PDF/Intent 파이프라인과의 동기화

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
  - Gaze, Speech, View State를 서로 다른 Buffer로 유지
- Adapter
  - Native Canvas 2D 렌더러 (`canvas-2d-renderer`)
  - 좌표, 리사이즈, 렌더링 컨텍스트 브릿지

## 코어 원칙

- React state에 Annotation 배열을 직접 보관하지 않음
- Canvas 렌더링은 Editor Core로부터 받은 `Annotation` 모델 기반
- 저장소/API 호출은 별도 Adapter/Service 계층에서 처리 예정
