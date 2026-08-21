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

## M3 (Phase C)

- [x] 고등학교 함수 graph evaluator/sampling 확장
- [x] graph point/label handler
- [x] tangent deterministic geometry
- [x] helper line 및 discontinuity-aware rendering

## M3 검증 결과

- [x] `pnpm --filter @ggulnote/math-core typecheck`
- [x] `pnpm --filter @ggulnote/math-core lint`
- [x] `pnpm --filter @ggulnote/math-core test` - 25/25 통과
- [x] `pnpm --filter @ggulnote/math-core build`
- [x] tldraw adapter 관련 테스트 - 6/6 통과
- [x] `pnpm typecheck` - 7 package 통과
- [x] `pnpm lint` - 7 package 통과
- [x] `pnpm build` - 7 package 및 Next production build 통과
- [ ] `pnpm test` - 988 통과, 기존 `editor-shell.test.tsx` 4건 실패

## M4 (Phase D)

- [x] 세로 덧셈·뺄셈·곱셈 setup handler
- [x] digit/carry/partial row/separator/cursor/add row mutation
- [x] 우측 정렬 arithmetic cell geometry와 rendering
- [x] Phase D stateless dispatcher

## M4 검증 결과

- [x] `pnpm --filter @ggulnote/math-core typecheck`
- [x] `pnpm --filter @ggulnote/math-core lint`
- [x] `pnpm --filter @ggulnote/math-core test` - 32/32 통과
- [x] `pnpm --filter @ggulnote/math-core build`
- [x] tldraw adapter 관련 테스트 - 6/6 통과
- [x] `pnpm typecheck` - 7 package 통과
- [x] `pnpm lint` - 7 package 통과
- [x] `pnpm build` - 7 package 및 Next production build 통과
- [ ] `pnpm test` - 988 통과, 기존 `editor-shell.test.tsx` 4건 실패

## 다음 Milestone (M5)

- [x] 필기형 rendering hint 검토 및 가능한 최소 적용
- [x] SVG turbulence 제거 및 tldraw `PathBuilder` draw stroke 적용
- [x] Object Catalog projection helper
- [x] Note Agent/Action Registry integration hook 정리

## M5 검증 결과

- [x] `pnpm --filter @ggulnote/math-core typecheck`
- [x] `pnpm --filter @ggulnote/math-core lint`
- [x] `pnpm --filter @ggulnote/math-core test` - 39/39 통과
- [x] `pnpm --filter @ggulnote/math-core build`
- [x] tldraw adapter/PathBuilder 관련 테스트 - 11/11 통과
- [x] `pnpm --filter @ggulnote/web lint`
- [ ] `pnpm --filter @ggulnote/web typecheck` - 병렬 Voice 파일의 기존 오류 1건
- [ ] root lint/typecheck/test/build 최종 확인

## M6 - Production flexible placement/tangent integration

- [x] 시작 전 branch/worktree 재확인 및 전용 branch 생성
- [x] production Voice/Decision/Runtime/tldraw 실행 경로 확인
- [x] 기존 strict one-decision ordered `steps[]` 유지
- [x] 생성 math action에 공통 destination schema 연결
- [x] 기존 placement engine으로 page region/relative/auto 좌표 계산
- [x] safe inset/default writing origin/natural gap 공통 policy 추가
- [x] `NEAR` 관계와 명시적 `INSIDE` overlay intent 지원
- [x] `math.graph.add_tangent` registry/schema/runtime 연결
- [x] at-point/at-x/quadrant/auto tangent request 검증
- [x] viewport 기반 deterministic 접점 선택 및 exact derivative/line 계산
- [x] tangent를 기존 GraphObject child로 유지
- [x] text-vs-math semantic prompt와 대표 few-shot 보강
- [x] READY action별 tool 검증 및 schema failure trace 보강
- [x] STATUS/SPEC/DECISIONS/CHECKLIST 갱신

## M6 검증 결과

- [x] `pnpm lint` - 7/7 package 통과
- [x] `pnpm typecheck` - 7/7 package 통과
- [x] `pnpm build` - 7/7 package 및 Next production build 통과
- [x] `pnpm --filter @ggulnote/math-core test` - 40/40 통과
- [x] 관련 web production/schema/provider/placement/tool 테스트 통과
- [ ] `pnpm test` - web 1002건 및 나머지 package 통과, 기존 `editor-shell.test.tsx` 4건 실패

## M6.1 - Blank text.create deterministic commit hotfix

- [x] telemetry 포함 실제 HTTP Decision envelope 재현
- [x] `destination: null`을 default notebook placement로 실행
- [x] blank/sparse scene에서 preview/VLM 호출 없이 deterministic placement
- [x] object count/occupied ratio/overlap 기반 local visual-context gate
- [x] complex scene의 기존 preview-validation 경로 유지
- [x] runtime result/errorCode/commitAttempted development trace 노출
- [x] HTTP → NoteRuntime → tldraw production 회귀 테스트

## M6.1 검증 결과

- [x] `pnpm --filter @ggulnote/web typecheck`
- [x] `pnpm --filter @ggulnote/web lint`
- [x] 관련 policy/tool/runtime/production 테스트 - 22/22 통과
- [x] `git diff --check`

## M6.2 - Repeated destination-null text.create hotfix

- [x] 객체 수/점유율 임계치에서 Runtime 경로가 바뀌는 원인 확인
- [x] `destination: null` 자동 배치를 visual threshold와 분리
- [x] 위치 미지정 생성은 항상 deterministic collision/bounds resolver 사용
- [x] 명시적 destination의 complex-scene preview validation 유지
- [x] 동일한 `안녕하세요 써줘` 6회 production route 회귀 테스트
- [x] 6개 tldraw text object commit 및 visual call 0회 검증

## M6.2 검증 결과

- [x] `pnpm --filter @ggulnote/web typecheck`
- [x] `pnpm --filter @ggulnote/web lint`
- [x] 관련 policy/tool/runtime/production 테스트 - 21/21 통과
- [x] `git diff --check`

## M7 - Visual Placement + Handwriting UX

- [x] object count/occupied ratio/overlap 기반 deterministic scene complexity policy
- [x] simple scene에서는 screenshot capture를 호출하지 않음
- [x] complex scene에서 현재 PDF/legacy overlay/tldraw page를 1280px 이하로 합성
- [x] Object Catalog와 screenshot을 같은 ONE strict Decision 요청에 첨부
- [x] screenshot은 layout evidence로만 사용하고 object identity는 Catalog가 소유
- [x] screenshot capture 실패/정지 시 1.2초 상한 후 Catalog-only Decision
- [x] visual context requested/attached/failure reason trace
- [x] local OFL Nanum Pen Script와 Latin/math fallback stack
- [x] 신규 `text.create`를 canonical custom shape 하나로 commit
- [x] 신규 math expression에 fixed-layout SVG reveal mask 적용
- [x] write-on duration 최소/최대 상한과 `prefers-reduced-motion` 지원
- [x] animation progress를 domain/TLStore/operation log에 저장하지 않음
- [x] replace/update/load/page revisit에서 create animation 재실행 방지
- [x] undo 1회로 신규 text object 전체 삭제
- [x] 6회 연속 `destination:null` text.create가 visual threshold 이후에도 commit되는 회귀 검증
- [x] tangent semantic `args.x/y`와 pixel-authority guard 충돌 수정
- [x] `mode:auto`의 null x/y provider parse 및 deterministic runtime 접점 선택 검증
- [x] `target.part.kind=curve` tangent 응답을 부모 GraphObject 수정으로 정규화
- [x] curve target production route에서 기존 graph shape 하나와 `tangents[]` 갱신 검증

## M7 검증 결과

- [x] `pnpm --filter @ggulnote/web typecheck`
- [x] `pnpm --filter @ggulnote/web lint`
- [x] `pnpm --filter @ggulnote/web build`
- [x] M7 visual/provider/runtime/renderer 관련 테스트 - 76/76 통과
- [x] screenshot timeout + production sequential 회귀 테스트 - 13/13 통과
- [x] `pnpm --filter @ggulnote/math-core typecheck`
- [x] `pnpm --filter @ggulnote/math-core lint`
- [x] `pnpm --filter @ggulnote/math-core test` - 40/40 통과
- [x] `pnpm --filter @ggulnote/math-core build`
- [ ] 전체 web test - 1019 통과, 기존 `editor-shell.test.tsx` 4건 실패
- [ ] 실제 OpenAI live eval - 현재 환경에 API key/model 없음
- [ ] 실제 `/canvas` 음성 demo sequence 수동 검증
