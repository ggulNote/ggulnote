# 독립 수학 객체/도구 모듈 체크리스트

- [x] 시작 전 branch/worktree 확인
- [x] 기존 editor/tldraw/Note Agent 구조 조사
- [x] M1 수행 시 Milestone을 Phase A로 고정
- [x] 독립 `@ggulnote/math-core` package 구성
- [x] Math Object Model 정의
- [x] action input/definition catalog 정의
- [x] serialization/deserialization 구현
- [x] layout/render adapter 계약 구현
- [x] 순수 함수 단위 테스트 추가
- [x] package lint/typecheck/test/build 실행
- [x] root 관련 검증 실행
- [x] STATUS/CHECKLIST 갱신

## M1 검증 결과

- [x] `pnpm --filter @ggulnote/math-core typecheck`
- [x] `pnpm --filter @ggulnote/math-core lint`
- [x] `pnpm --filter @ggulnote/math-core test` - 8/8 통과
- [x] `pnpm --filter @ggulnote/math-core build`
- [x] `pnpm typecheck` - 7 package 통과
- [x] `pnpm lint` - 7 package 통과
- [ ] `pnpm test` - M1 당시 기존 web 경로 5건 실패

## M2 (Phase B)

- [x] MathExpression create/update/insert handler와 최소 rendering
- [x] MathTable create/set cell/add row/add column handler와 cell geometry/rendering
- [x] 기본 도형 geometry 검증, label/mark handler와 rendering
- [x] 1차·2차 함수 evaluator/sampling/rendering
- [x] stateless Phase B action dispatcher와 render operation 반환
- [x] `ggulnote-math` custom shape와 tldraw upsert/delete adapter
- [x] canvas shape util 등록과 editor adapter hook

## M2 검증 결과

- [x] `pnpm --filter @ggulnote/math-core typecheck`
- [x] `pnpm --filter @ggulnote/math-core lint`
- [x] `pnpm --filter @ggulnote/math-core test` - 17/17 통과
- [x] `pnpm --filter @ggulnote/math-core build`
- [x] tldraw adapter 관련 테스트 - 6/6 통과
- [x] `pnpm typecheck` - 7 package 통과
- [x] `pnpm lint` - 7 package 통과
- [x] `pnpm build` - 7 package 및 Next production build 통과
- [ ] `pnpm test` - 984 통과, 기존 `editor-shell.test.tsx` 4건 실패(STATUS Known Problems 참조)

## 다음 Milestone (M3)

- [ ] 고등학교 함수 graph evaluator/sampling 확장
- [ ] graph point/label handler
- [ ] tangent deterministic geometry
- [ ] helper line 및 discontinuity-aware rendering
