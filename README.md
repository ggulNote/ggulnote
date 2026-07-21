# ggulnote

## 프로젝트 소개

꿀노트는 사용자의 시선으로 PDF/백지 편집 영역을 지정하고, 음성 명령으로 필기 도구를 제어하는
핸즈프리 문서 편집 애플리케이션입니다.

본 단계는 **Canvas Editor Core** 구현입니다.

## 현재 단계

- 1단계 기반 구성(Next.js, Turborepo, 테스트/CI) 기반
- PDF 및 백지 뷰어 정상 동작 유지(로컬 열기, PDF.js 렌더링, 페이지 이동/확대축소)
- Annotation Overlay 캔버스 추가 및 편집 코어 동작

## 구현 범위

### 구현 완료

- Annotation 객체 모델
  - TEXT, UNDERLINE, HIGHLIGHT, SHAPE(rectangle/ellipse), LINE(line/arrow), TABLE
- 페이지별 Scene 관리
- Command 패턴 기반 편집 엔진
  - CREATE / UPDATE / DELETE / MOVE + Undo/Redo
- Canvas 2D Editor Renderer Adapter
- 포인터 인터랙션
  - 선택(히트 테스트), 이동(드래그 미리보기 + 커밋/취소), 삭제
- 개발용 툴바 및 디버그 패널 연동
- 문서/페이지 전환 시 Scene 보존
- 정규화 좌표 기준 렌더링·히트테스트
- Annotation 직렬화/역직렬화

### 제외(미구현)

- IndexedDB/영구 저장
- Supabase 연동
- 원격 문서 동기화
- 시선/카메라/음성/LLM 연동
- PDF에 직접 Annotation 그리기 저장
- 표 셀 편집, 크기 조정, 회전, 자유형 스케치

## 핵심 제약

- 새로고침 시 생성된 Annotation은 메모리에서만 유지되어 사라집니다.
- 최종 서비스의 음성/시선 제어는 향후 단계에서 대체됩니다.

## 기술 스택

- Next.js App Router (v16)
- React 19
- TypeScript strict
- Tailwind CSS
- Turborepo
- pnpm workspace
- ESLint
- Vitest + React Testing Library
- pdfjs-dist (로컬 worker)

## 프로젝트 구조

- `apps/web`: Next.js 애플리케이션
  - `features/document`: PDF/백지 뷰어
  - `features/editor`: Annotation Canvas Overlay, Interaction, Core Adapter 레이어
- `packages/editor-core`: Canvas Editor Core
  - Annotation 모델, Scene/스토어, Command, Engine, Renderer 인터페이스, 직렬화
- `packages/shared-types`: 정규화 좌표/ID 공용 타입

## 설치

```bash
corepack enable
pnpm install
```

## 로컬 실행

```bash
pnpm dev
```

접속 URL:

```text
http://localhost:3000
http://localhost:3000/editor
http://localhost:3000/debug
```

## 실행/검증 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 문서

- `docs/architecture.md`: 웹/에디터 아키텍처 현재 구조
- `docs/canvas-editor.md`: Editor Core 구현 상세

## 다음 개발 단계

- IndexedDB 로컬 저장(메모리 대체)
- 운영 모듈 연동(시선/음성/LLM)
