# 05 Semantic Layer 정확도 개선 보고서

## 구현 결과

Text Item -> Word -> Line 파이프라인의 좌표와 방향 정보를 보강하고, Line 이후에 LayoutRegion, LayoutBlock, Column 분석을 추가했다. Reading Order는 페이지 전체 `y -> x` 정렬 대신 Region -> Column -> Block -> Line -> Word 계층으로 계산한다. Paragraph는 Block/Column 내부에서 먼저 만들고 Sentence는 각 Paragraph 내부에서만 생성한다. Sentence와 Paragraph에는 실제 텍스트 구간을 나타내는 `fragments`를 저장하며, Semantic Query는 envelope가 아니라 fragment를 기준으로 direct hit을 판정한다.

기존 PDF Viewer, 백지 Viewer, Canvas Editor, Annotation 저장/복구 흐름은 변경하지 않았다. Semantic Core는 PDF.js, React, Dexie, IndexedDB를 import하지 않으며 PDF.js 좌표 변환은 Web extractor에, Semantic Cache는 Web persistence adapter에 유지했다.

## Root cause

- Word 과도 분리: 기존 tokenization이 punctuation까지 독립 Word 후보로 만들고, 의미 있는 URL, 이메일, citation run을 충분히 보존하지 않았다.
- Word bounds 겹침: 기존 sub-bounds가 원문 문자 수 비율과 전역 x축에 의존하여 glyph 폭 차이와 회전 방향을 반영하지 못했다.
- 두 컬럼 Line 결합: 기존 Line grouping이 baseline, y-center, vertical overlap 중심이었고 진행 방향의 큰 whitespace 경계를 강하게 분리하지 않았다.
- 회전 Text 혼합: Web extractor에서 PDF transform의 angle, local axis, quad를 Semantic input까지 보존하지 않았다.
- Sentence 컬럼 침범: 페이지 전체 Word를 하나의 문자열과 Reading Order로 flatten한 뒤 Sentence를 만들었다.
- Paragraph 페이지 확장: LayoutBlock/Column 경계가 모델에 없고 전역 Line accumulator가 gap과 indentation만으로 Paragraph를 결합했다.
- 빈 공간 direct hit: 여러 줄 Sentence/Paragraph를 하나의 union envelope로만 표현하고 query도 envelope를 direct hit으로 사용했다.
- 캐시 반복 혼선: source geometry와 model 구조를 식별할 signature가 없어 같은 item count의 변경 입력을 충분히 구분하지 못했다.

## 새 구조

### Orientation 모델

- Text Item transform에서 `Math.atan2(transform[1], transform[0])`로 angle을 계산한다.
- 부동소수점 오차를 정규화해 `horizontal`, `vertical`, `rotated` writing mode로 분류한다.
- `TextOrientation`, `LocalTextAxis`, `TextQuad`를 Text Item, Word, Line, Layout 객체와 직렬화 데이터에 보존한다.
- 회전 sidebar는 삭제하지 않고 다른 orientation의 Line 및 LayoutBlock으로 분리한다.

### Word geometry 방식

- 빈 문자열, whitespace-only, invalid/zero-size bounds는 Word를 생성하지 않는다.
- punctuation을 독립 문자 후보로 과도하게 만들지 않고 인접 run에 결합한다.
- URL, 이메일, citation, code-like non-whitespace run을 의미 있는 단위로 유지한다.
- 각 Word에 `sourceTextItemId`, `startOffset`, `endOffset`을 저장한다.
- DOM/font API 없이 deterministic하게 동작하도록 glyph 종류별 weight fallback을 사용한다.
- prefix cumulative weight를 Text Item local baseline과 quad에 적용해 horizontal/rotated Word 위치를 계산한다.
- 모든 Word는 독립 bounds와 quad 객체를 가진다.

### Line grouping 방식

- orientation angle, local normal projection, baseline 거리, perpendicular overlap을 함께 사용한다.
- 같은 baseline에서도 진행 방향 gap이 median cross size와 예상 space advance에 비해 크면 Line을 분리한다.
- `hasEOL`은 강한 경계 신호지만 유일한 기준으로 사용하지 않는다.
- tolerance는 고정 CSS pixel이 아니라 normalized geometry, Word 높이, font size, space advance에 비례한다.
- Line bounds는 포함 Word의 정확한 union이다.

### LayoutRegion, LayoutBlock, Column

- horizontal Line은 시각적 row와 y-band로 먼저 나눈다.
- 각 band 내부의 whitespace와 x interval overlap으로 local column을 추정한다.
- full-width title/metadata band와 multi-column body를 서로 다른 Region/Block으로 유지한다.
- 다른 orientation의 sidebar는 별도 Region/Block으로 유지한다.
- Block type은 `heading`, `body`, `sidebar`, `metadata`, `unknown`의 초기 휴리스틱 분류를 제공한다.

### Reading Order 알고리즘

Reading Order는 다음 순서로 계산한다.

```text
LayoutRegion
Column
LayoutBlock
Line
Word
```

full-width title/author 이후 multi-column body에서는 왼쪽 컬럼 전체를 읽은 뒤 오른쪽 컬럼을 읽는다. 동일 y의 좌우 컬럼을 번갈아 읽는 전역 `y -> x` 정렬은 사용하지 않는다.

### Paragraph 생성 방식

- Paragraph는 LayoutBlock 및 Column 내부에서만 생성한다.
- orientation, blockId, columnId가 다르면 강제로 분리한다.
- vertical gap은 이전 Line bottom과 현재 Line top의 차이로 계산한다.
- 큰 gap, indentation, heading/block 경계를 사용하고 accumulator를 경계마다 초기화한다.
- Paragraph fragments는 포함 Line bounds로 구성한다.

### Sentence 생성 방식

- Paragraph를 먼저 만든 뒤 Paragraph 내부 Line/Word만 재구성한다.
- Sentence offset과 Word 범위는 `wordStart < sentenceEnd && wordEnd > sentenceStart` overlap으로 매핑한다.
- Paragraph, Block, Column, orientation 경계를 넘지 않는다.
- 같은 Paragraph의 line-break hyphen은 다음 줄의 소문자 시작 등 제한된 조건에서 복원한다.
- Sentence fragments는 Sentence가 각 Line에서 실제로 차지하는 Word union으로 구성한다.

### Fragment geometry와 Query

- Sentence/Paragraph의 `bounds`는 coarse envelope로 유지한다.
- `fragments`는 실제 Line 또는 Word 텍스트 영역을 나타낸다.
- `findAtPoint`는 bounds coarse filter 후 fragment hit을 검사한다.
- envelope 내부이지만 fragment 밖인 빈 공간은 direct hit이 아니다.
- `findNearest`는 fragment까지의 거리를 계산하며 `directHit: false`로 구분한다.
- `findInRect`도 fragment overlap을 우선한다.
- 후보에는 `directHit`, `fragmentOverlap`, `distance`, `regionId`, `blockId`, `columnId`, `readingOrder`를 포함한다.

## Semantic Query API

- `findAtPoint(point, options)`: fragment 기반 direct 후보 조회
- `findNearest(point, options)`: fragment 거리 기반 nearest 후보 조회
- `findInRect(rect, options)`: fragment overlap 기반 영역 후보 조회
- `getLayoutRegions()`: 페이지 Region 조회
- `getLayoutBlocks()`: 페이지 Block 조회
- `getColumns()`: 페이지 Column 조회
- `getAllByReadingOrder()`: 계층 Reading Order의 Semantic 객체 조회

## 디버그 UI

- Text Item, Word, Line, LayoutRegion, LayoutBlock, Column을 개별 토글할 수 있다.
- Sentence bounds/fragments와 Paragraph bounds/fragments를 별도로 토글할 수 있다.
- Reading Order와 Candidate 레이어를 개별 토글할 수 있다.
- `Bounding boxes only` 옵션을 기본 활성화해 라벨이 bounds를 가리지 않게 했다.
- 선택 후보 패널에서 direct hit, blockId, columnId, fragment 정보를 확인할 수 있다.

## 직렬화와 캐시

- Semantic model `schemaVersion`: 1 -> 2
- extractor version: 2 -> 3
- IndexedDB database version: 기존 2 유지
- 기존 `version(1)` 선언은 삭제하거나 변경하지 않았다.
- 기존 `version(2).stores({ semanticPages })` 구성도 유지했다.
- 새 직렬화에는 orientation, local axis, quad, regions, blocks, columns, block/column IDs, fragments, source signature가 포함된다.
- `PageSemanticModel.fromSerialized`는 현재 schema/extractor version을 엄격히 확인하여 이전 version 2 extractor cache를 복원하지 않는다.
- source Text Item geometry의 deterministic signature가 일치할 때만 cache hit으로 사용한다.
- cache miss 또는 복원 실패 시 현재 페이지만 다시 빌드하고 soft failure로 Viewer/Editor 동작을 계속한다.
- 문서 삭제 시 기존 문서/annotation/operation/semanticPages 원자적 삭제 흐름을 유지한다.
- 확대/축소는 Semantic Model 재생성 조건이 아니다.
- Pointer Move에서는 모델 생성이나 저장을 수행하지 않고 click 후보 조회만 수행한다.

## 주요 생성 및 수정 파일

### 생성 파일

- `packages/document-core/tests/layout-model.test.ts`
- `apps/web/tests/document-debug-panel.test.tsx`

### 수정 파일

- `packages/document-core/src/types.ts`
- `packages/document-core/src/constants.ts`
- `packages/document-core/src/geometry.ts`
- `packages/document-core/src/builder.ts`
- `packages/document-core/src/page-semantic-model.ts`
- `packages/document-core/src/index.ts`
- `packages/document-core/tests/model.test.ts`
- `apps/web/src/features/document/model/document-types.ts`
- `apps/web/src/features/document/text/extract-page-text.ts`
- `apps/web/src/features/document/model/document-state.ts`
- `apps/web/src/features/document/components/document-workspace.tsx`
- `apps/web/src/features/document/components/document-debug-panel.tsx`
- `apps/web/src/features/document/local-persistence/types.ts`
- `apps/web/src/features/document/local-persistence/repositories/semantic-page-repository.ts`
- `apps/web/tests/extract-page-text.test.ts`
- `docs/reports/05-semantic-layer.report.md`

## 테스트

추가 및 보강한 synthetic 테스트는 다음을 검증한다.

- invalid bounds 제거
- horizontal/90도 orientation
- local baseline 방향의 Word advance
- Word bounds 독립 객체와 비중첩
- whitespace 제거와 URL/이메일/citation 보존
- 작은 Text Item gap 결합과 같은 baseline의 컬럼 분리
- full-width title 및 local two-column Region/Block/Column
- rotated sidebar 분리
- 계층 Reading Order
- Paragraph 내부 Sentence와 multi-line fragments
- envelope 내부 fragment 외부 클릭의 direct hit 배제
- fragment 위 클릭 및 nearest 구분
- orientation/layout/fragments 직렬화 복원
- 이전 cache version 거부
- right/bottom 기준 `unionBounds`
- PDF.js horizontal/rotated Text Item 추출
- Bounding boxes only UI

테스트 결과:

- document-core: 2 files, 16 tests 통과
- web: 6 files, 18 tests 통과
- root 전체: shared-types 1, document-core 16, editor-core 24, web 18, 총 59 tests 통과
- Web test에서 jsdom의 `HTMLCanvasElement.getContext` 미구현 stderr 경고가 출력됐지만 assertion과 test command exit code는 성공했다.

## 검증 결과

- `pnpm --filter @ggulnote/document-core typecheck`: 성공
- `pnpm --filter @ggulnote/document-core build`: 성공
- `pnpm --filter @ggulnote/document-core test`: 성공, 16/16
- `pnpm --filter @ggulnote/web lint`: 성공
- `pnpm --filter @ggulnote/web typecheck`: 성공
- `pnpm --filter @ggulnote/web test`: 성공, 18/18
- `pnpm --filter @ggulnote/web build`: 성공, `/editor` 포함 production build
- `pnpm lint`: 성공, 4/4 tasks
- `pnpm typecheck`: 성공, 4/4 tasks
- `pnpm test`: 성공, 4/4 tasks, 59 tests
- `pnpm build`: 성공, 4/4 tasks
- `git diff --check`: 성공

환경 경고:

- 저장소 요구 Node는 `>=22`지만 실행 환경은 Node `20.19.4`여서 모든 pnpm 명령에 engine warning이 출력됐다.
- root build는 TypeScript package의 Turbo output 설정이 없다는 기존 warning을 출력했지만 build는 성공했다.

## 계획과 다르게 구현한 부분

- 초기 5단계 계획의 단순 Text -> Word -> Line -> Sentence -> Paragraph 구조만으로는 mixed layout 문제를 해결할 수 없어, 사용자의 정확도 개선 명세에 따라 LayoutRegion, LayoutBlock, Column과 fragment geometry를 최소 범위로 추가했다.
- 실제 font metric API는 Semantic Core의 순수성과 deterministic 결과를 유지하기 위해 직접 사용하지 않았다. 대신 extractor가 전달한 quad/local axis와 deterministic glyph-weight fallback을 사용했다.
- 외부 PDF layout 분석 라이브러리는 추가하지 않았다.
- IndexedDB database schema는 새 DB version을 추가하지 않고 기존 version 2 semanticPages store를 유지했다. 모델 cache 구조만 schema 2/extractor 3으로 무효화했다.

## 변경 전후 대표 데이터

Synthetic same-baseline fixture 기준:

```text
변경 전 개념적 결과
Line: left + continues + right column
두 컬럼 전체 envelope

변경 후 검증 결과
Line 1: "left continues", x=0.10, right=0.38
Line 2: "right column", x=0.58, right=0.88
```

Mixed-layout fixture 기준:

```text
Reading Order
A Full Width Title
Author One and Author Two
Left column first/second/third
Right column first/second/third
rotated sidebar는 별도 sidebar block
```

Query fixture 기준:

```text
Sentence envelope 내부 + fragment 외부: direct candidate 없음
Sentence fragment 위: SENTENCE directHit=true
가까운 빈 공간: nearest candidate directHit=false
```

## 수동 확인이 필요한 항목

다음 항목은 실제 테스트 PDF와 브라우저 수동 조작으로 확인하지 않았으므로 성공으로 보고하지 않는다.

- 테스트 페이지 A의 Text Item, Word, Line, LayoutRegion, LayoutBlock, Column, Sentence, Paragraph overlay
- 테스트 페이지 B의 full-width title/authors와 2단 body 분리
- 회전 arXiv sidebar의 실제 위치와 Reading Order
- 실제 fragment 및 빈 envelope 공간의 좌표 클릭 후보
- 페이지 이동 후 cache 재사용
- 새로고침 후 IndexedDB Semantic Cache 사용
- 확대/축소 시 model 재사용
- 백지 Empty 상태
- 기존 Annotation 생성, 드래그, 삭제, undo의 브라우저 조작
- 기존 문서 및 Annotation의 실제 IndexedDB 복구

## 남은 제한 사항

- glyph-weight fallback은 실제 embedded font glyph metric, kerning, ligature와 완전히 같지 않다.
- 복잡한 표, 수식, 다중 floating caption, 불규칙 polygon column은 heuristic Region/Block 분석의 한계가 있다.
- RTL, 세로쓰기 CJK, 임의 각도 곡선 텍스트는 orientation은 보존하지만 Reading Order 정밀도에 추가 fixture가 필요하다.
- block type 분류는 초기 heuristic이며 논문별 heading/metadata 스타일을 완벽히 분류하지 않는다.
- PDF.js Text Item 자체가 비정상 geometry를 제공하는 경우 유효성 검사는 제거할 수 있지만 실제 glyph 위치를 복원하지는 못한다.
- OCR, 시선 추적, ROI 이미지, LLM 기능은 이번 범위에 포함하지 않았다.

## 다음 시선 ROI 단계의 연결 지점

Semantic Query 후보는 실제 fragment geometry와 `regionId`, `blockId`, `columnId`, `readingOrder`, direct/nearest 구분을 제공한다. 다음 ROI 단계에서는 gaze 좌표 또는 ROI rect를 normalized page coordinate로 변환한 뒤 `findAtPoint`, `findNearest`, `findInRect`를 호출하면 된다. Semantic Core는 시선 장치나 React를 알지 않으며, Web adapter에서 gaze/ROI 입력을 query로 변환하는 구조를 유지할 수 있다.

## 현재 Git 상태

- 브랜치: `feat/semantic-layer`
- 변경 사항은 commit하지 않은 working tree 상태다.
- commit, push, Pull Request는 수행하지 않았다.
