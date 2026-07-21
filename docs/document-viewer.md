# PDF/Blank 문서 뷰어 설계

## 문서 모델

```ts
type DocumentKind = "none" | "pdf" | "blank";

interface DocumentDescriptor {
  id: string;
  kind: Exclude<DocumentKind, "none">;
  name: string;
  pageCount: number;
}
```

- `pdf`: PDF 문서 메타(페이지 수, 파일 크기) 기반의 렌더링 대상
- `blank`: A4 세로, 단일 페이지 백지 문서

## PDF 로딩 흐름

1. 로컬 `<input type="file">`로 PDF 선택
2. 파일 유효성 검사 (`type`, 확장자, 크기, 빈 파일)
3. `File → arrayBuffer() → Uint8Array`
4. `pdfjs-dist` `getDocument({ data })`로 로드
5. `PDFDocumentProxy` 유지 관리 및 페이지 접근
6. 페이지 이동/zoom 변경 시 현재 페이지만 재렌더링

## Worker 구성

- `pdfjs-dist` 설치본과 같은 버전의 worker를 번들 내에서 로드

```ts
const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
library.GlobalWorkerOptions.workerSrc = workerUrl;
```

- 네트워크 CDN 또는 하드코딩된 버전 URL 사용하지 않음
- 빌드 산출물에서 worker 파일 자동 번들/복사 경로 사용

## 페이지 렌더링 흐름

1. 현재 페이지 번호 변경 또는 zoom 변경 감지
2. 기존 Render Task 취소
3. `page.getViewport({ scale, rotation })` 생성
4. Canvas DPR 기반 크기 설정 (`canvas.width/height`는 물리 픽셀)
5. `page.render({ canvasContext, viewport })`
6. 렌더 완료 후 원본/표시 크기 갱신

## 좌표계

- 페이지 기준 정규화 좌표: `x,y ∈ [0,1]`
- 화면 포인터 좌표를 정규화 좌표로 변환
- 정규화 좌표를 CSS px로 역변환
- zoom/스크롤 변화와 무관하게 정규화 값은 0~1 범위 유지

## Text Content 추출

- 현재 페이지 표시 완료 후 `page.getTextContent()` 호출
- 페이지별 지연 추출 및 캐시
- `TextItem`의 transform 기반 바운딩 박스 계산
- 페이지 밖 값은 clamp/필터

## 리소스 정리

- 문서 교체/닫기 시:
  - 기존 Render Task 취소
  - `PDFDocumentLoadingTask.destroy()` 호출
  - `PDFDocumentProxy.cleanup(true)` 호출
  - 이벤트 리스너/ResizeObserver 정리

## 현재 제한 사항

- 모든 페이지 동시 렌더링 미지원
- OCR/스캔 PDF 텍스트 인식 미지원
- 비밀번호 PDF/네트워크 PDF 미지원
- Annotation/Undo/Redo 미지원

## 향후 Canvas Editor 연결 위치

- `DocumentStage`의 동일한 레이어 규격 아래
  - PDF/Blank Base Layer 위
  - 빈 Annotation Layer를 둬서 다음 단계에서 Annotation Canvas를 마운트
