# Branch & Collaboration Guide

## 브랜치 역할

- `main`: 배포/릴리스 기준 브랜치
  - 기본적으로 검증 완료된 코드만 병합
  - 기능 개발용 커밋은 직접 푸시하지 않음

- `develop`: 개발 통합 브랜치
  - 일상적인 개발 작업의 기본 대상 브랜치
  - 기능/버그 수정은 `develop`에서 커밋 후 `origin/develop`으로 푸시
  - `main` 반영 전 사전 검증/통합을 수행

- `feat/*`, `fix/*`, `chore/*` : 임시 작업 브랜치
  - `develop`에서 분기해 작업
  - 작업 완료 후 `develop`으로 병합하거나 PR을 통해 반영

## develop에서의 기본 규칙

1. 모든 변경은 먼저 `develop` 계열 브랜치에 반영
2. 커밋은 짧고 명확한 메시지를 사용
3. `develop`에 푸시하여 CI와 팀 공유
4. 기능 완결 후 `main`용 PR 생성

예시:
- `feat/editor-shell-placeholder`
- `fix/debug-dashboard-state`
- `chore/docs-readme-sync`

## 권장 커밋 메시지

`type(scope): description`

예시:
- `feat(editor): add placeholder controls to editor shell`
- `fix(debug): correct placeholder labels`
- `docs(readme): update main branch project overview`

## PR 기준

- 대상 브랜치: `main`
- 최소 체크리스트
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- UI 변경은 접근성/문구/실패 상태 처리 여부를 리뷰 항목에 포함

## 현재 저장소 분기 사용 규칙(요약)

- `main`에 푸시한 내용은 배포 대상 기준선
- `develop`은 개발 저장소로 계속 사용
- `develop`은 main 병합 대상(주기적 통합)로 관리
