# ggulnote

## 프로젝트 소개

꿀노트는 사용자의 시선으로 PDF/백지 편집 영역을 지정하고, 음성 명령으로 필기 도구를 제어하는
핸즈프리 문서 편집 애플리케이션입니다.

본 단계는 **2단계: PDF 및 백지 뷰어**를 구현합니다.

## 현재 단계

- 1단계 기반 구성(Next.js, Turborepo, 테스트/CI) 기반
- **로컬 PDF/백지 문서 뷰어 + 좌표 변환 + 페이지 탐색 + 확대/축소** 구현
- 캔버스 기반 Annotation / 시선 추적 / 음성 입력은 미구현

## 구현 범위

### 구현 완료

- 로컬 PDF 파일 열기
- PDF 문서 렌더링(현재 페이지 1장)
- PDF 텍스트 아이템 지연 추출
- 백지 문서( A4 세로 1페이지 ) 생성
- 페이지 이동/이동 입력
- 확대/축소/100%/화면 너비 맞춤
- 정규화 좌표 표시 및 역변환
- 문서 디버그 패널(문서 종류, 현재 페이지, zoom, 텍스트 개수 등)
- PDF.js(local worker) 기반 렌더링

### 미구현(다음 단계)

- Canvas Annotation(밑줄/형광펜/텍스트/도형)
- 시선 추적 및 카메라
- 음성 인식(STT)/LLM
- Supabase 연동(저장소/동기화)
- OCR, 클라우드 배포 API 연동, 결제

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
- `apps/web/src/features/document`: PDF/blank 뷰어 핵심 기능
  - `adapters/pdfjs`: PDF.js 로더/문서/렌더 어댑터
  - `hooks`: 문서 세션/페이지 렌더링/fit-width 훅
  - `components`: 툴바/스테이지/사이드바/디버그 패널
  - `coordinates`: 정규화 좌표 변환
  - `text`: 페이지 텍스트 추출
  - `validation`: PDF 파일 유효성 검사

## 사전 요구 사항

- Node.js 22 권장
- pnpm

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

## Vercel 배포 설정

- GitHub: `ggulNote/ggulnote`
- Framework: `Next.js`
- Root Directory: `apps/web`
- Package Manager: `pnpm`
- Production Branch: 저장소 기본 브랜치(main)
- 환경 변수: 현재 단계에서는 없음
- PR마다 Preview Deployment 사용 가능

## 브라우저 요구/제한

- PDF는 클라이언트 메모리 내에서만 처리됩니다.
- 로컬 파일 업로드/원격 저장소 전송 없음
- PDF 파일 크기 최대: **50MB**

## 다음 개발 단계

- Canvas Editor Core 구현
