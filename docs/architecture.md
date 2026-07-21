# Architecture

## 현재 구조

- React Editor UI
- Document Viewer
  - PDF.js Adapter
  - Document Session
  - Page Renderer
  - Text Content Extractor
  - Coordinate Transformer
  - Blank Page Renderer

## 향후 구조

- React Editor UI
  - Document Stage
    - Base Document Layer
    - Text/Semantic Layer
    - Annotation Canvas Layer
    - Interaction Layer
- Canvas Editor Core
- Gaze/Voice/Intent Integration

## 아키텍처 원칙

- React UI와 Canvas Editor Core는 분리하여 상태를 명확히 분리한다.
- 문서 좌표는 정규화 좌표(0~1) 기반으로 관리한다.
- 브라우저에서 외부 LLM API를 직접 호출하지 않는다.
- 저장소/AI 호출은 Adapter 인터페이스 뒤로 분리한다.
- Supabase는 핵심 UI·렌더 파이프라인 안정화 이후 단계적으로 연결한다.
- Cloud Run은 현재 단계에서 사용하지 않는다.
