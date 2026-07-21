# Architecture

## 현재 구조

- React UI
- Editor Shell Placeholder

## 향후 구조

- React UI
- PDF Document Engine
- Canvas Editor Core
- Semantic Layer
- Gaze Engine
- Voice Engine
- ROI Context Builder
- Intent Gateway

## 아키텍처 원칙

- React UI와 Canvas Editor Core를 분리한다.
- 문서 좌표는 정규화 좌표(Normalized Coordinates) 기반으로 전환한다.
- 브라우저에서 외부 LLM API를 직접 호출하지 않는다.
- 저장소/AI 호출은 Adapter 인터페이스 뒤로 분리한다.
- Supabase 연동은 핵심 UI 파이프라인 안정화 이후 단계적으로 추가한다.
- 현재 단계에서는 Cloud Run을 사용하지 않는다.
