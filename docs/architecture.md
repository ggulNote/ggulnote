# Architecture

## 현재 구조

- `apps/web`
  - Next.js/React UI
  - PDF.js Viewer Adapter
  - Native Canvas Adapter
  - Dexie Local Persistence Adapter
- `packages/document-core`
  - PDF.js 비의존 순수 TypeScript Semantic Core
  - `Text Item -> Word -> Provisional LineFragment -> LayoutRegion`
  - Region-local parser
    - `prose -> Column -> Line -> Paragraph -> Sentence`
    - `form -> FormFieldRow(marker/label/value)`
    - `table -> SemanticTable`
    - `heading/footer/metadata -> local Line/Block`
  - fragment-aware Semantic Query와 직렬화
- `packages/editor-core`
  - Annotation, Page Scene, Command, Undo/Redo, Hit Test, 직렬화
- `packages/shared-types`
  - 문서 ID와 0~1 정규화 좌표 타입

## 핵심 경계

- `document-core`는 React, PDF.js, Dexie를 import하지 않는다.
- Column/gutter evidence는 같은 `LayoutRegion` 내부에서만 계산한다.
- PDF Canvas와 Annotation Canvas를 분리한다.
- IndexedDB에는 PDF.js/Canvas 객체가 아닌 직렬화 데이터만 저장한다.