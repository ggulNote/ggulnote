# ggulnote

## 프로젝트 소개

꿀노트는 사용자의 시선으로 PDF 또는 백지의 편집 영역을 지정하고, 음성 명령으로 필기 도구를 제어하는 핸즈프리 문서 편집 애플리케이션입니다.

현재는 프론트엔드 중심의 로컬 우선 구조로 개발하고 있으며, PDF/백지 Viewer, Canvas Editor Core, IndexedDB 로컬 저장을 구현했습니다.

## 현재 구현 범위

### Document Viewer

- 로컬 PDF 파일 열기와 PDF.js 기반 렌더링
- PDF 원본을 `Blob`으로 처리
- A4 백지 문서 생성
- 페이지 이동과 확대/축소
- 100% 보기와 화면 너비 맞춤
- PDF Text Item 지연 추출
- 화면 좌표와 정규화 문서 좌표 변환

### Canvas Editor Core

- Annotation 모델
  - `TEXT`, `UNDERLINE`, `HIGHLIGHT`, `SHAPE`, `LINE`, `TABLE`
- 페이지별 Scene 관리
- Command 기반 생성, 수정, 이동, 삭제
- Undo/Redo
- 선택, Hit Test, 이동, 크기 조정
- Native Canvas 2D Renderer Adapter
- 정규화 좌표 기반 렌더링
- Annotation 직렬화와 역직렬화
- Editor Operation 생성

### IndexedDB 로컬 저장

- Dexie 기반 IndexedDB Adapter
- 문서 메타데이터와 PDF `Blob` 저장
- 페이지별 직렬화된 Annotation Snapshot 저장
- Editor Operation append-only 저장
- 저장 요청 순서를 보장하는 Save Queue
- Snapshot과 Operation의 Transaction 저장
- 낮은 Revision이 최신 Snapshot을 덮어쓰지 않도록 보호
- 최근 문서, 현재 페이지, Zoom, Zoom Mode 자동 복구
- 새로고침 후 페이지별 Annotation 복구
- 문서 관련 데이터의 Transaction 삭제 API
- 실제 Transaction 완료 이후 저장 상태 갱신

Editor Core는 Dexie 또는 IndexedDB를 직접 import하지 않습니다. 브라우저 저장 구현은 `apps/web`의 Local Persistence Adapter에만 위치합니다.

## 현재 제한 사항

- 데이터는 현재 브라우저에만 저장됩니다.
- 브라우저 사이트 데이터를 삭제하면 저장된 PDF와 Annotation도 삭제될 수 있습니다.
- Undo/Redo History는 새로고침 후 복구하지 않습니다.
- 여러 탭의 동시 편집과 충돌 해결을 지원하지 않습니다.
- 로컬 문서 목록, 삭제, 저장 공간 및 Persistent Storage 관리 UI는 개발 화면에 완전히 연결되지 않았습니다.
- Supabase, 사용자 계정, 원격 동기화, 클라우드 백업을 지원하지 않습니다.
- 시선 추적, 음성 인식, LLM 연동은 아직 구현하지 않았습니다.
- PDF Annotation 내보내기는 지원하지 않습니다.

## 기술 스택

- Next.js App Router 16
- React 19
- TypeScript strict mode
- Tailwind CSS
- Turborepo
- pnpm workspace
- PDF.js
- Native Canvas 2D
- Dexie / IndexedDB
- Vitest / React Testing Library

## 프로젝트 구조

```text
apps/web
├─ src/app
├─ src/features/document
│  ├─ adapters/pdfjs
│  ├─ components
│  ├─ hooks
│  └─ local-persistence
└─ src/features/editor

packages/editor-core
├─ annotation
├─ commands
├─ engine
├─ rendering
├─ scene
└─ serialization

packages/shared-types
```

## 사전 요구 사항

- Node.js 22 이상
- pnpm 10.9.0

## 설치

```bash
corepack enable
pnpm install
```

## 로컬 실행

저장소 루트에서 실행합니다.

```bash
pnpm dev
```

접속 URL:

```text
http://localhost:3000
http://localhost:3000/editor
http://localhost:3000/debug
```

## 검증 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## 관련 문서

- `AGENTS.md`: 저장소 개발 지침
- `docs/architecture.md`: 현재 아키텍처
- `docs/canvas-editor.md`: Canvas Editor Core 상세
- `docs/specs/04-indexeddb-local-persistence.md`: IndexedDB 로컬 저장 명세
- `docs/plans/04-indexeddb-local-persistence.plan.md`: 구현 계획

## 다음 단계

다음 단계에서는 PDF Text Item을 단어, 라인, 문장, 문단 구조로 변환하고 시선 좌표 주변의 후보 객체를 생성하는 Semantic Layer와 ROI 후보 생성을 진행합니다.
