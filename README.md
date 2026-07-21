# ggulnote

## 프로젝트명

ggulnote(꿀노트)

## 서비스 설명

꿀노트는 시선 추적 영역 지정과 음성 명령을 통해 밑줄/형광펜/텍스트/도형 주석을 생성하는 핸즈프리 필기 애플리케이션입니다.

## 현재 개발 단계

1단계: Next.js 기반 프로젝트 기반 구성 (스켈레톤)

## 현재 구현 범위

- pnpm workspace + Turborepo 구성
- Next.js(App Router) 앱 기본 구조
- TypeScript strict mode
- `src` 디렉터리
- Tailwind CSS 기본 스타일
- ESLint flat config
- Turbopack 실행 환경
- Vitest + React Testing Library
- 기본 페이지: `/`, `/editor`, `/debug`
- 기본 에러/로딩/Not Found 바운더리
- GitHub Actions CI
- Vercel 배포 설정 문서

## 구현되지 않은 범위

- PDF 렌더링/업로드
- 캔버스 편집
- 시선 추적
- 음성 인식(STT)
- 어노테이션 생성/동기화
- Supabase/Auth/PostgreSQL/Storage/Edge Function
- LLM 연동(외부 API 호출)
- 백엔드/Cloud Run

## 기술 스택

- Node.js 22
- pnpm (workspace)
- Turborepo
- Next.js (최신 안정화 버전)
- React
- TypeScript
- Tailwind CSS
- ESLint (flat config)
- Vitest + jsdom
- React Testing Library
- GitHub Actions

## 프로젝트 구조

```text
ggulnote/
  .github/
    workflows/
      ci.yml
  apps/
    web/
      public/
      src/
        app/
          debug/
          editor/
          favicon.ico
          globals.css
          layout.tsx
          loading.tsx
          not-found.tsx
          error.tsx
          page.tsx
        components/
          layout/
        features/
          home/
            components/
          editor/
            components/
          debug/
            components/
        tests/
      eslint.config.mjs
      next.config.ts
      package.json
      postcss.config.mjs
      tsconfig.json
      vitest.config.ts
      vitest.setup.ts
  docs/
    architecture.md
    development.md
  .gitignore
  .nvmrc
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  turbo.json
  README.md
```

## 사전 요구 사항

- Node.js 22 이상
- pnpm (`corepack` 권장)

## 설치

```bash
corepack enable
pnpm install
```

## 로컬 실행

```bash
pnpm dev
```

접속 주소:

- `http://localhost:3000`
- `http://localhost:3000/editor`
- `http://localhost:3000/debug`

## lint

```bash
pnpm lint
```

## typecheck

```bash
pnpm typecheck
```

## test

```bash
pnpm test
```

## build

```bash
pnpm build
```

## Vercel 배포 설정

- GitHub 저장소 Import
- Repository: `ggulNote/ggulnote`
- Framework Preset: `Next.js`
- Root Directory: `apps/web`
- Package Manager: `pnpm`
- Production Branch: 저장소 기본 브랜치(main)
- 현재 단계에서 필요한 환경변수 없음
- PR마다 Preview Deployment 사용 가능

## 다음 단계

1단계에서는 실제 PDF 및 백지 뷰어/핸즈프리 편집 기능을 구현하지 않으며, 다음 단계에서
`PDF 및 백지 뷰어 구현`로 시작합니다.
