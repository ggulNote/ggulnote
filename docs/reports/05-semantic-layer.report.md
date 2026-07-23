# 05 Semantic Layer 구현 보고서

## 구현한 기능

- PDF.js Text Item을 정규화 문서 좌표로 변환하는 Web Adapter를 보완했다.
- Text Item을 Word로 분리하고 Word, Line, Sentence, Paragraph 모델을 생성하는 순수 TypeScript Semantic Core를 추가했다.
- 동일 입력에서 동일 Semantic ID와 직렬화 결과를 생성하도록 런타임 시각과 처리 시간을 Semantic Model 결과에서 제거했다.
- 현재 페이지를 중심으로 Semantic Model을 지연 생성하고, 확대·축소 시 같은 페이지 모델을 재사용한다.
- 좌표 클릭 시 WORD, LINE, SENTENCE, PARAGRAPH 후보를 조회한다.
- Text Item, Word, Line, Sentence, Paragraph, Candidate 디버그 오버레이와 상태 패널을 연결했다.
- IndexedDB Version 2에 semanticPages store를 추가하고 페이지 Semantic Cache를 저장·복원한다.
- Semantic Cache 실패를 PDF Viewer와 Canvas Editor 흐름에서 분리했다.
- 백지와 Text Item이 없는 페이지를 Empty 상태로 처리한다.
- 문서 삭제 시 관련 Semantic Cache도 같은 삭제 흐름에서 제거한다.
- Next.js App Router의 editor route에 최소 Client Component 경계를 추가했다.

## 주요 생성·수정 파일

- packages/document-core/src/builder.ts
- packages/document-core/src/page-semantic-model.ts
- packages/document-core/src/segmentation.ts
- packages/document-core/src/geometry.ts
- packages/document-core/src/types.ts
- packages/document-core/src/constants.ts
- packages/document-core/tests/model.test.ts
- apps/web/src/features/document/text/extract-page-text.ts
- apps/web/src/features/document/components/document-workspace.tsx
- apps/web/src/features/document/components/document-debug-panel.tsx
- apps/web/src/features/document/local-persistence/database.ts
- apps/web/src/features/document/local-persistence/repositories/semantic-page-repository.ts
- apps/web/src/features/document/local-persistence/application/local-editor-persistence.ts
- apps/web/src/features/document/local-persistence/types.ts
- apps/web/src/app/editor/editor-page-client.tsx
- apps/web/tests/extract-page-text.test.ts

## Text Item에서 Paragraph까지의 처리 흐름

1. Web PDF.js Adapter가 PDFPageProxy.getTextContent를 호출한다.
2. 공백 문자열, 유효하지 않은 transform, 0 크기, 페이지 밖 rect를 제외한다.
3. TextItem.width와 TextItem.height 및 transform 방향 벡터로 Text Item 전체 bounds를 계산하고 0~1 좌표로 한 번만 정규화한다.
4. Semantic Core가 Text Item 문자열을 Intl.Segmenter 또는 정규식 fallback으로 Word token으로 분리한다.
5. 원문 안에서 각 token의 시작·끝 문자 위치를 찾아 부모 Text Item bounds 안에 독립적인 Word bounds를 배치한다.
6. Word의 수직 겹침과 높이 비례 중심 거리로 Line을 구성한다.
7. Line을 column과 baseline 기준 Reading Order로 정렬한다.
8. 정렬된 Word 문자열의 문자 범위와 Sentence segment 범위를 대응시켜 Sentence를 만든다.
9. column 변경, 줄 간격, 들여쓰기 차이로 Paragraph 경계를 정하고 Line과 Sentence를 Paragraph에 연결한다.
10. PageSemanticModel이 직렬화, 요약, 좌표 Query API를 제공한다.

## Line Tolerance와 Reading Order 방식

- 같은 Line 조건은 수직 겹침 비율이 0.3 이상이거나, 두 Text Item 중심 거리의 절댓값이 기준 높이의 0.55 이하인 경우다.
- 기준 높이는 현재 Word 높이, Line draft의 중앙 높이, 페이지 Word 중앙 높이의 절반 중 큰 값으로 계산한다.
- 고정 CSS Pixel은 사용하지 않고 정규화된 Text Item 높이에 비례한다.
- Line 내부 Word는 LTR이면 x 오름차순, RTL이면 x 내림차순으로 정렬한다.
- Line은 x 영역의 겹침으로 column을 추론한 뒤 column index, baseline 순으로 Reading Order를 부여한다.

## Sentence와 Paragraph 분리 방식

- Sentence는 Intl.Segmenter를 우선 사용하고 지원되지 않으면 마침표, 물음표, 느낌표 계열 문자를 순회하는 fallback을 사용한다.
- Sentence segment의 문자 offset과 Word별 문자 범위를 교차시켜 Sentence의 Word 범위를 결정한다.
- 문장 종결 부호가 없거나 여러 줄이 하나의 segment로만 반환되는 경우 페이지 전체를 하나로 묶지 않고 Line 단위 fallback을 사용한다.
- Paragraph는 column 변경, 중앙 줄 간격과 Text Item 높이에 비례한 gap threshold, 이전 Line 대비 들여쓰기 차이를 경계로 사용한다.
- Paragraph gap 계산의 이전 Line 인덱스 off-by-one 오류를 수정했다.

## Semantic Query API

- findAtPoint: 좌표를 포함하는 Semantic 객체 조회
- findNearest: 좌표에서 가까운 Semantic 객체 조회
- findInRect: 정규화 영역과 겹치는 Semantic 객체 조회
- getAllByReadingOrder: Reading Order 기준 전체 객체 조회
- getSummary: 타입별 개수와 페이지 요약 조회
- fromSerialized 및 toSerialized: Cache 복원과 저장

현재 editor 클릭 조회는 WORD, LINE, SENTENCE, PARAGRAPH를 대상으로 한다. 포함 후보가 없으면 nearest, 작은 영역 조회 순으로 fallback한다. 포함 후보의 우선순위는 Sentence, Paragraph, Line, Word 순이다.

## IndexedDB Version 2 변경

- 기존 Version 1 선언과 기존 store 정의는 유지했다.
- Version 2를 추가하고 semanticPages store를 구성했다.
- Semantic Cache record에는 documentId, pageId, pageNumber, extractorVersion, semanticSchemaVersion, sourceItemCount, serialized model을 저장한다.
- Semantic Core는 Dexie 또는 IndexedDB를 import하지 않으며, Dexie 구현은 Web Persistence Adapter에만 존재한다.
- 문서 삭제 트랜잭션에서 문서, 파일, Annotation 관련 데이터와 함께 해당 documentId의 semanticPages record를 제거한다.

## Cache 저장 및 무효화 흐름

1. 현재 PDF 페이지 렌더가 끝나면 해당 페이지 Text Item만 요청한다.
2. 페이지 ID와 Text Item 내용·좌표 fingerprint가 현재 메모리 모델과 같으면 재생성하지 않는다.
3. IndexedDB에서 extractorVersion과 semanticSchemaVersion이 같은 record를 조회한다.
4. Cache hit이면 PageSemanticModel.fromSerialized로 복원한다.
5. Cache miss 또는 stale이면 순수 TypeScript builder로 모델을 만들고 저장한다.
6. 이번 좌표 알고리즘 변경으로 extractorVersion을 2로 올려 기존 잘못된 Cache를 자동 무효화했다.
7. Cache 읽기·쓰기 실패는 error 또는 miss 상태로 처리하되 Viewer와 Canvas Editor는 계속 동작한다.
8. 페이지 전환 시 요청 token으로 늦게 끝난 이전 페이지 결과를 폐기한다.

## 정확도 문제 원인과 수정

- PDF Text Item 전체 width 대신 transform[0]을 사용한 오류를 TextItem.width 사용으로 수정했다.
- Word width 계산에서 weight 비율을 두 번 나누어 앞쪽 Word가 줄 시작에 몰리던 오류를 원문 문자 범위 기반 배치로 교체했다.
- 각 Word bounds는 새 객체로 생성하며 부모 Text Item bounds 안에 배치한다.
- 인접한 시각적 줄을 같은 Line으로 허용하던 과도한 gap 조건을 수직 겹침과 높이 비례 중심 거리 조건으로 교체했다.
- Sentence offset을 공백 개수로 역산하던 방식을 Word 문자 범위 교차 방식으로 교체했다.
- Paragraph gap 계산에서 두 줄 전을 비교하던 인덱스 오류를 수정했다.
- 페이지 렌더 상태 변화가 같은 페이지 Semantic Model을 초기화하지 않도록 activePageId를 기준으로 수명을 관리한다.

## 테스트와 빌드 결과

- pnpm lint: 통과
- pnpm typecheck: 통과
- pnpm test: 통과
- pnpm build: 통과
- git diff --check: 통과

추가된 회귀 테스트는 다음을 검증한다.

- TextItem.width가 transform 글꼴 스케일과 다를 때 전체 Text Item width를 사용하는지
- 공백 문자열과 0 크기 Text Item을 제외하는지
- 같은 Text Item에서 분리된 Word의 x가 증가하고 width와 height가 양수인지
- Word bounds가 부모 Text Item 범위 안에 있고 서로 같은 bounds 객체를 공유하지 않는지
- 같은 시각적 줄의 Text Item은 하나의 Line, 다음 줄은 별도 Line인지
- 여러 Sentence와 큰 수직 간격의 Paragraph가 페이지 전체 객체로 합쳐지지 않는지
- 동일 입력의 Semantic Model 직렬화 결과가 동일한지

검증 환경은 Node v20.19.4였고 package.json 요구사항 Node 22 이상 경고가 출력됐다. 명령은 모두 성공했다. 웹 테스트에는 jsdom의 HTMLCanvasElement.getContext 미구현 경고가 출력됐지만 테스트 실패는 아니었다.

## 계획과 다르게 구현한 부분

- 실제 PDF 증상 조사 결과 tolerance 조정보다 앞단의 Text Item width 계산과 Word width 수식 오류가 핵심이어서 해당 구조적 오류를 우선 수정했다.
- 잘못 저장된 기존 모델이 재사용되지 않도록 계획의 Cache version 비교 흐름을 유지하면서 extractorVersion을 1에서 2로 올렸다.
- Semantic Model의 결정성을 위해 createdAt과 processingDurationMs를 결과에서 0으로 고정했다. Cache record의 저장 시각은 Persistence 계층이 별도로 관리한다.
- Next.js 16에서 Server Component의 dynamic ssr false 사용이 허용되지 않아 editor-page-client.tsx를 최소 Client Component 경계로 추가했다.

## 수동 확인이 필요한 항목

저장소에 검증용 PDF fixture가 없어 다음 항목은 성공으로 확인하지 않았다.

- 실제 텍스트 PDF의 Text Item, Word, Line, Sentence, Paragraph Debug Layer 육안 정합성
- 좌표 클릭 시 기대 Sentence 또는 Paragraph가 1순위인지
- 페이지 전환 후 Cache 재사용
- 새로고침 후 IndexedDB Semantic Cache 사용
- 실제 백지 문서의 Empty 상태
- 기존 Annotation 선택·이동·편집·삭제
- 기존 PDF 문서 및 Annotation 복구
- 회전된 PDF, RTL, 세로쓰기 PDF의 bounds 정합성

## 현재 제한 사항

- PDF.js는 Text Item 전체 width를 제공하지만 Word별 glyph advance를 직접 제공하지 않는다. 현재 Word 폭은 Text Item 안의 문자 위치 비율로 근사하므로 가변폭 글꼴, kerning, 합자에서는 글자 단위로 완전히 일치하지 않을 수 있다.
- Sentence 품질은 PDF 텍스트 순서와 문장부호, Intl.Segmenter 결과에 의존한다.
- Paragraph는 줄 간격, column, 들여쓰기 기반 heuristic이며 표, 복잡한 다단 편집, 장식 텍스트에서 추가 보정이 필요할 수 있다.
- OCR, 시선 추적, ROI 이미지, LLM 기능은 구현하지 않았다.
- Semantic Model 내부 처리 시간은 결정성을 위해 0이며 실제 성능 측정은 별도 비결정적 telemetry가 필요하다.

## 다음 시선 ROI 단계의 연결 지점

- 시선 좌표는 현재와 같은 0~1 NormalizedPoint로 findAtPoint 또는 findNearest에 전달할 수 있다.
- 시선 체류 영역은 NormalizedRect로 만들어 findInRect에 전달할 수 있다.
- Query 결과의 type, bounds, readingOrder, confidence, distance를 ROI 후보 랭킹 입력으로 사용할 수 있다.
- 현재 단계는 좌표 Query까지만 제공하며 시선 추적, dwell 처리, ROI 이미지 생성은 추가하지 않았다.

## 현재 Git 상태

- 현재 브랜치: feat/semantic-layer
- 워크트리: Semantic Layer 관련 tracked 파일 수정 및 신규 파일이 있는 dirty 상태
- commit, push, Pull Request: 수행하지 않음
