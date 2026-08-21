# 독립 수학 객체/도구 모듈 - 현재 상태

## Branch

`feat/flexible-note-interaction`

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
- production Note Agent의 단일 Decision/ordered `steps[]` 경로에 6개 math action 연결.
- 모든 생성 math tool에 공통 destination과 기존 placement engine 연결.
- `NotebookLayoutPolicy`의 safe inset/natural gap으로 빈 페이지 및 상대 배치 보정.
- `math.graph.add_tangent`를 registry/schema/runtime에 연결하고 접점 선택·미분·clip을 순수 함수로 구현.
- semantic tool description/few-shot과 strict response trace를 보강.
- M6.1에서 blank/sparse `text.create`가 불필요한 preview validation 때문에 commit되지 않는 production 회귀 수정.
- object count/occupied ratio/overlap만 보는 local `needsVisualContext`로 단순 scene은 deterministic commit.
- development Note Agent trace에 runtime result/error/commit 여부 노출.
- M6.2에서 `destination:null` 자동 배치가 visual threshold를 넘을 때 preview 경로로 전환되던 반복 생성 cliff 수정.
- 위치 미지정 생성은 객체 수와 무관하게 같은 deterministic resolver를 사용하고, 명시적 복잡 배치만 preview 검증 유지.
- M7에서 object count/occupied ratio/overlap 기반 local gate가 complex scene만 현재 page screenshot을 준비한다.
- PDF base, legacy overlay, tldraw export를 1280px 이하로 합성하고 Object Catalog와 같은 strict Decision 요청에 첨부한다.
- screenshot capture는 1.2초 안에 끝나지 않거나 실패하면 Catalog-only Decision으로 안전하게 내려간다.
- 신규 text와 math expression은 local OFL Nanum Pen Script fallback stack과 presentation-only write-on reveal을 사용한다.
- canonical object, undo, persistence에는 animation progress가 저장되지 않는다.
- tangent의 semantic `args.x/y`가 범용 pixel-authority guard에 차단되던 `INITIAL_PARSE` 회귀를 수정했다.
- tangent step의 `args.x/y`만 좁게 허용하고 selector/destination 및 다른 action의 임의 좌표 금지는 유지한다.
- strict Decision이 graph의 unqualified `curve` part를 target으로 반환해도 math tool이 부모 `GraphObject` 수정으로 정규화한다.
- 실제 provider 응답 형태의 curve target으로 production route를 통과해 동일 tldraw graph shape의 `tangents[]`가 갱신되는 회귀 테스트를 추가했다.
- math-core 및 web typecheck/lint/build, M7 관련 테스트와 전체 web 회귀 테스트 실행 완료.

## Completed Milestone

`M7 (Visual Placement + Handwriting UX)` 구현 완료.

## Current Milestone

없음. 다음 Milestone은 별도 결정 전까지 시작하지 않는다.

## Known Problems

- 전체 `pnpm test`에서 기존 web 테스트 4건이 실패한다.
  - `tests/editor-shell.test.tsx` 4건: jsdom 환경의 `image.decode is not a function`.
  - web 1019건과 math-core 40건은 통과했다.
- 저장소 요구 Node 버전은 `>=22`이나 현재 검증 환경은 Node `v20.19.4`여서 engine warning이 출력된다.
- 현재 환경에는 `OPENAI_API_KEY`와 `DIRECT_COMMAND_MODEL`이 없어 실제 OpenAI live eval은 실행하지 못했다.
- 실제 `/canvas` 브라우저에서 음성 demo sequence를 수동 실행하는 검증은 남아 있다.

## Next Milestone

- 아직 registry에 연결되지 않은 catalog capability의 metadata 정합성과 동일 Decision 내 create-follow-up 참조 지원.
