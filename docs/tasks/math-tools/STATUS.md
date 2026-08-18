# 독립 수학 객체/도구 모듈 - 현재 상태

## Branch

`refactor/tldraw-object-catalog-one-decision`

## Current State

- 요구사항과 기존 editor/tldraw/Scene Core 구조 조사 완료.
- 기존 Voice Agent cutover 미커밋 변경과 겹치지 않는 별도 package 경계 확정.
- `@ggulnote/math-core`에 Object Model, 33개 action contract, serialization, base layout, render adapter boundary 구현.
- expression/table/basic shape의 순수 handler와 1차·2차 graph evaluator/sampling 구현.
- cubic/quartic/absolute/rational/radical/exponential/logarithmic/trigonometric evaluator 구현.
- discontinuity-aware segment sampling, analytic derivative, graph point/tangent/helper line handler 구현.
- graph sub-entity SVG primitive와 stateless Phase C dispatcher 구현.
- add/subtract/multiply setup과 digit/carry/partial row/separator/cursor/add row 기록 handler 구현.
- 우측 정렬 arithmetic child geometry, SVG primitive, stateless Phase D dispatcher 구현.
- opt-in `handDrawn` visual hint와 tldraw `PathBuilder` seeded draw stroke 적용.
- Note Agent에 의존하지 않는 Object Catalog projection helper 구현.
- runtime object lookup/id allocation만 주입받는 Action Registry integration preparation hook 구현.
- React 독립 SVG visual model, `ggulnote-math` custom shape, tldraw upsert/delete adapter 구현.
- canvas shape util 등록 및 기존 editor adapter에 독립 math render hook 추가.
- math-core test/typecheck/lint/build와 tldraw math 관련 test, web lint 완료.

## Completed Milestone

`M5 (Phase E)` 완료.

## Current Milestone

없음 - 요청된 Phase A-E 범위 완료.

## Known Problems

- 전체 `pnpm test`에서 기존 web 테스트 4건이 실패한다.
  - `tests/editor-shell.test.tsx` 4건: jsdom 환경의 `image.decode is not a function`.
  - 마지막 전체 실행 기준 988건은 통과했다.
- 현재 web typecheck는 병렬 Voice 변경의 기존 오류 1건에서 실패한다.
  - `llm-note-decision-provider.ts:108`: `TextRangeRepairResult`에 record index signature가 없음.
  - math-core 39건과 tldraw math 관련 11건은 통과한다.
- 저장소 요구 Node 버전은 `>=22`이나 현재 검증 환경은 Node `v20.19.4`여서 engine warning이 출력된다.

## Next Milestone

- 별도 승인 시 기존 Note Agent/Action Registry에 action definition과 preparation hook을 등록한다.
- 별도 승인 시 tldraw math shape를 Unified Object World 수집 경로에 연결한다.
