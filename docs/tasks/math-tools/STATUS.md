# 독립 수학 객체/도구 모듈 - 현재 상태

## Branch

`refactor/tldraw-object-catalog-one-decision`

## Current State

- 요구사항과 기존 editor/tldraw/Scene Core 구조 조사 완료.
- 기존 Voice Agent cutover 미커밋 변경과 겹치지 않는 별도 package 경계 확정.
- `@ggulnote/math-core`에 Object Model, 33개 action contract, serialization, base layout, render adapter boundary 구현.
- expression/table/basic shape의 순수 handler와 1차·2차 graph evaluator/sampling 구현.
- React 독립 SVG visual model, `ggulnote-math` custom shape, tldraw upsert/delete adapter 구현.
- canvas shape util 등록 및 기존 editor adapter에 독립 math render hook 추가.
- package test/typecheck/lint/build와 workspace typecheck/lint 완료.

## Completed Milestone

`M2 (Phase B)` 완료.

## Current Milestone

`M3 (Phase C)` - 고등학교 함수 graph 확장과 점/접선/helper line의 deterministic handler

## Known Problems

- 전체 `pnpm test`에서 기존 web 테스트 4건이 실패한다.
  - `tests/editor-shell.test.tsx` 4건: jsdom 환경의 `image.decode is not a function`.
  - math-core 17건과 tldraw math 관련 6건은 모두 통과한다.
- 저장소 요구 Node 버전은 `>=22`이나 현재 검증 환경은 Node `v20.19.4`여서 engine warning이 출력된다.

## Next Milestone

- cubic/quartic, absolute, rational, radical, exponential, logarithmic, sin/cos/tan evaluator를 typed descriptor로 확장한다.
- graph point, tangent, helper line과 label handler를 추가한다.
- 곡선 discontinuity 처리와 접선 미분을 순수 함수 테스트로 검증한다.
