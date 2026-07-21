# 개발 메모

## 개발 환경

- Node.js: 22
- pnpm workspace + Turborepo 사용
- Next.js App Router 기반 웹 앱

## 다음 개발 순서

1. PDF Document Engine PoC
2. PDF/Blank 문서 뷰어 구현
3. Canvas Editor Core 구현
4. Engine Adapter 연결
5. 시선 추적/음성 입력/Intent 파이프라인 연동

## Vercel 설정 가이드

- GitHub 연동 Import: `ggulNote/ggulnote`
- Framework Preset: `Next.js`
- Root Directory: `apps/web`
- Package Manager: `pnpm`
- Production Branch: 기본 브랜치(`main`)
- 환경 변수: 현재 단계에서는 없음
- PR마다 Preview Deployment으로 확인 가능
