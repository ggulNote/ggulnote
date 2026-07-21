# ggulnote

시선 추적과 음성 명령을 활용한 핸즈프리 필기 애플리케이션입니다.

사용자가 바라보는 문서 영역을 인식하고, 음성 명령에 따라 밑줄, 형광펜, 텍스트, 도형 등의 주석을 생성합니다.

## 주요 기능

* PDF 및 백지 기반 필기
* 웹캠 기반 시선 추적
* 시선 위치 기반 편집 영역 지정
* 음성 명령 기반 필기 도구 실행
* 밑줄, 형광펜, 텍스트, 도형 주석 생성
* 문서 및 어노테이션 저장동기화
* 핸즈프리 문서 탐색 및 편집

## 기술 스택

### Frontend

* Next.js App Router
* React
* TypeScript
* Tailwind CSS
* Turbopack

### Monorepo

* pnpm Workspace
* Turborepo

### Testing

* Vitest
* React Testing Library
* jsdom

### Infrastructure

* GitHub Actions
* Vercel
* Supabase
* Google Cloud Run

## 프로젝트 구조

```text
ggulnote/
 .github/
    workflows/
 apps/
    web/
        public/
        src/
            app/
            components/
            features/
            tests/
 docs/
 package.json
 pnpm-workspace.yaml
 turbo.json
 README.md
```

## 실행 환경

* Node.js 22 이상
* pnpm

## 설치

```bash
corepack enable
pnpm install
```

## 로컬 실행

```bash
pnpm dev
```

```text
http://localhost:3000
http://localhost:3000/editor
http://localhost:3000/debug
```

## 개발 명령어

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 배포

웹 애플리케이션은 Vercel을 통해 배포합니다.

* Framework: Next.js
* Root Directory: `apps/web`
* Package Manager: `pnpm`
* Production Branch: `main`
* Pull Request Preview Deployment 지원

## 라이선스

본 프로젝트의 라이선스는 추후 정의합니다.
