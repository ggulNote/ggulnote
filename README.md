# ggulnote

꿀노트는 PDF 또는 백지 위의 편집 영역을 지정하고 Annotation을 생성·편집하는 로컬 우선 문서 편집 애플리케이션입니다.

## 아키텍처

```text
apps/web
├─ React / Next.js UI
├─ PDF.js Document Viewer Adapter
├─ Native Canvas 2D Editor Adapter
└─ Dexie / IndexedDB Persistence Adapter

packages/document-core
└─ Text Item → Word → Line → Layout/Column → Paragraph/Sentence Semantic Core

packages/editor-core
└─ Annotation, Scene, Command, Undo/Redo, Hit Test, Serialization

packages/shared-types
└─ 패키지 간 공유 ID, 좌표, 문서 타입
```

- `apps/web`은 브라우저 API와 외부 라이브러리 Adapter를 담당합니다.
- `document-core`는 React, PDF.js, Dexie에 의존하지 않는 순수 TypeScript입니다.
- `editor-core`는 UI와 저장 기술에 의존하지 않는 Canvas Editor 도메인 로직입니다.
- Annotation과 Semantic 좌표는 확대율과 무관한 `0~1` 정규화 좌표를 사용합니다.

## 핵심 명령어

```bash
corepack enable
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

전체 검증은 다음 명령으로 실행할 수 있습니다.

```bash
pnpm check
```
