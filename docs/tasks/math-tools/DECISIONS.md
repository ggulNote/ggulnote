# 독립 수학 객체/도구 모듈 결정 사항

## 결정 1: 별도 workspace package

- 수학 도메인은 `packages/math-core`에 둔다.
- React, tldraw, Voice/Note Agent에 의존하지 않는다.
- 공통 좌표 타입만 `@ggulnote/shared-types`에서 사용한다.

## 결정 2: logical object와 렌더링 분리

- 저장 단위는 `MathObject` 하나이며 그래프의 점·접선, 도형의 라벨·mark, 필산의 cell/row는 sub-entity다.
- tldraw에는 최종적으로 `ggulnote-math` custom shape 하나를 logical boundary로 투영한다.
- Phase A에서는 tldraw를 import하지 않고 render plan과 upsert/delete operation만 정의한다.

## 결정 3: 수식은 display source + 작은 AST

- 표시/편집 fallback을 위한 `source` 문자열을 항상 가진다.
- 분수·지수·첨자·루트·괄호·등식·연립식에 필요한 작은 AST만 둔다.
- 해석, 단순화, 정답 판정 기능은 두지 않는다.

## 결정 4: 그래프는 typed function descriptor

- `functionType`, display expression, numeric parameters, domain으로 함수를 기술한다.
- 범용 expression execution이나 CAS는 도입하지 않는다.
- sampling/미분/교점은 Phase C의 독립 순수 함수로 구현한다.

## 결정 5: 필산은 기록 모델

- 숫자를 number가 아닌 string cell로 보존한다.
- carry, partial row, separator, cursor를 명시적으로 저장한다.
- action handler는 사용자가 준 값을 기록할 뿐 계산하거나 검증하지 않는다.

## 결정 6: 현재 cutover 파일 비접촉

- 병렬 진행 중인 `apps/web` tldraw adapter와 Note Agent 파일을 M1에서 수정하지 않는다.
- 후속 연결은 math render operation을 web adapter가 소비하는 단방향 dependency로 추가한다.

## 결정 7: handler는 저장소를 소유하지 않음

- Phase B handler는 현재 객체와 action을 받아 다음 `MathObject`와 `MathRenderOperation`을 반환한다.
- create id는 입력 또는 외부 `createObjectId` 함수로 받으며 전역 counter나 runtime 상태를 두지 않는다.
- Voice/Note Agent가 붙을 때 대상 조회와 persistence는 기존 registry/runtime이 소유한다.

## 결정 8: geometry 좌표 책임

- shape geometry의 점과 반지름은 logical object bounds 내부의 local 좌표로 해석한다.
- graph descriptor의 점은 수학 좌표이며 visual model이 bounds 내부 SVG 좌표로 변환한다.
- table cell bounds, graph sampling, 직선/반직선 연장은 React와 분리된 순수 함수가 계산한다.

## 결정 9: M2 그래프는 typed 1차·2차 함수만 평가

- `linear`은 `a`, `b`, `quadratic`은 `a`, `b`, `c` parameter를 사용한다.
- expression 문자열을 실행하거나 파싱하지 않는다.
- 나머지 function type은 모델에는 유지하되 evaluator/handler 지원은 Phase C로 미룬다.

## 결정 10: tldraw에는 versioned snapshot 하나를 저장

- `ggulnote-math` custom shape props에 logical id, object kind, serialized math object를 둔다.
- custom shape는 math-core가 만든 SVG primitive를 매핑만 하며 수학 계산을 하지 않는다.
- TLStore snapshot에는 수학 shape가 보존되지만 legacy annotation projection과 Object Catalog 투영은 Phase E까지 제외한다.

## 결정 11: M3 함수 parameter convention

- 다항식은 차수 내림차순으로 `a`, `b`, `c`, `d`, `e`를 사용한다.
- absolute/rational/radical은 `a`, horizontal shift `h`, vertical shift `k`를 사용한다.
- exponential/logarithmic은 `a`, `base`, `h`, `k`를 사용하며 base 기본값은 2다.
- sin/cos/tan은 amplitude `a`, angular frequency `b`, phase shift `h`, vertical shift `k`를 사용하고 각도 단위는 radian이다.
- display expression 문자열은 실행하거나 parameter 추출에 사용하지 않는다.

## 결정 12: 불연속 구간과 접선

- sampling 결과는 point 배열 하나가 아니라 continuous segment 배열로도 제공한다.
- rational의 `x=h`와 tan의 주기적 점근선 사이에서 segment를 분리해 렌더러가 점근선을 가로질러 잇지 않게 한다.
- 접선 기울기는 typed descriptor의 analytic derivative로 구하고 viewport 경계에 deterministic하게 clip한다.
- 미분 불가능하거나 무한 기울기인 위치는 현재 finite slope 모델에서 접선 생성 요청을 거절한다.

## 결정 13: M4 setup은 빈 work row까지만 만든다

- operand는 원문 문자열의 Unicode character를 오른쪽부터 column 0에 배치한다.
- 마지막 operand row에 연산자를 붙이고 add/subtract는 빈 result row, multiply는 빈 partial row를 만든다.
- setup은 separator나 결과값을 자동 생성하지 않고 빈 work row의 column 0에 cursor만 둔다.

## 결정 14: 필산 mutation은 기록만 한다

- `write_digit` 이름과 무관하게 전달된 문자열을 그대로 cell에 저장하며 숫자 여부를 검사하지 않는다.
- partial row의 values는 표시 순서인 왼쪽에서 오른쪽으로 받고, geometry만 오른쪽 기준 column으로 바꾼다.
- carry는 같은 column/source row 조합을 수정하며 어떤 산술 관계도 확인하지 않는다.
- arithmetic geometry는 React와 분리하고 layout engine과 SVG visual model이 같은 순수 계산 결과를 사용한다.

## 결정 15: hand-drawn은 opt-in presentation hint

- `style.handDrawn`은 logical geometry나 sampling 결과를 바꾸지 않는다.
- visual model은 `precise`/`hand-drawn` hint와 기본 font 선택만 결정한다.
- tldraw custom shape는 hint가 켜진 경우에만 공개 `PathBuilder`의 seeded `draw` stroke를 적용한다.
- line/polyline/rect/circle/arc는 adapter의 순수 변환 함수가 PathBuilder로 바꾸고, text와 정확 스타일은 기존 SVG를 유지한다.
- fill은 정확 SVG로 유지하고 hand-drawn 외곽선만 PathBuilder로 렌더링한다.
- 별도 rough rendering dependency, SVG turbulence 또는 비결정적 geometry는 도입하지 않는다.

## 결정 16: Object Catalog projection은 Note Agent에 구조적으로만 맞춘다

- math-core는 Note Agent나 editor-core 타입을 import하지 않는다.
- request-local handle, page size, selected/focused/recent 상태는 호출자가 주입한다.
- catalog bounds는 현재 Note Agent 계약과 같이 page-normalized 좌표로 만든다.
- expression과 arithmetic layout은 기존 Scene kind 제약에 맞춰 `math`, 나머지는 `table`/`graph`/`shape`로 투영한다.
- 하위 요소는 최대 12개까지 compact part로 제공하고, 객체 종류별 후속 action capability를 명시한다.

## 결정 17: integration hook은 side effect를 소유하지 않는다

- `prepareMathActionExecution`은 기존 객체 조회와 create id 할당만 외부 port로 받는다.
- 최신 Phase D dispatcher를 호출해 다음 object와 render operation을 반환한다.
- persistence, transaction, tldraw apply, catalog handle allocation은 기존 runtime/registry가 담당한다.
- 병렬 작업 중인 Voice/Note Agent 파일에는 M5에서 직접 등록하지 않는다.

## 결정 18: 생성 위치는 기존 placement engine 하나가 계산한다

- text와 math create tool은 공통 Decision destination을 소비한다.
- tool별 `belowObject`나 pixel 좌표 필드를 추가하지 않는다.
- `NotebookLayoutPolicy`는 safe inset과 natural gap만 소유하고, collision/shift/clamp는 기존 placement engine이 수행한다.
- 위치가 없는 blank canvas도 editable bounds 안의 deterministic default writing origin을 사용한다.

## 결정 19: tangent Decision은 의미만, math runtime은 정확한 선을 만든다

- LLM은 target graph와 at-point/at-x/quadrant/auto request만 선택한다.
- point-on-curve 검증, derivative, line intercept, viewport clipping은 `math-core` 순수 함수가 담당한다.
- quadrant/auto는 고정 x를 사용하지 않고 현재 graph viewport의 visible 후보를 deterministic하게 평가한다.
- 생성된 tangent는 기존 `MathGraph.tangents[]`에 기록되어 GraphObject 하나의 logical boundary를 유지한다.

## 결정 20: connected tool metadata가 strict action schema를 만든다

- production에 연결된 math action 목록과 definition lookup을 schema/tool registry 양쪽에서 공유한다.
- create action만 nullable destination을 허용하고 existing-object action은 target을 요구한다.
- READY 응답도 request 시점 registry에 없는 tool을 거절한다.

## 결정 21: planner 실패 trace는 구조만 기록한다

- response format은 기존 strict `json_schema`를 유지하고 자유 텍스트에서 JSON을 추출하지 않는다.
- request type/schema version, structured response status, validation path, action index를 trace에 남긴다.
- transcript, 전체 document, raw model output은 production failure trace에 추가하지 않는다.

## 결정 22: 단순 scene은 preview 없이 deterministic commit한다

- `destination: null`은 placement 누락이나 실패가 아니라 Runtime default notebook placement 요청이다.
- blank/sparse scene은 Object Catalog geometry와 editable bounds만으로 충분하므로 preview canvas와 VLM을 호출하지 않는다.
- visual gate는 object count, occupied ratio, overlap pair만 사용하며 자연어를 다시 파싱하지 않는다.
- 복잡 scene의 기존 preview-validation은 유지한다.
- 이 gate는 post-decision placement 실행 정책이며 initial LLM screenshot context는 M7 범위로 남긴다.

## 결정 23: 위치 미지정 자동 배치는 visual threshold로 실행 경로를 바꾸지 않는다

- `destination: null`은 Runtime의 default notebook placement이며 사용자 의미가 이미 확정된 상태다.
- object count나 occupied ratio가 늘어도 deterministic collision/bounds resolver를 계속 사용한다.
- 위치를 명시한 요청만 complex-scene gate 이후 기존 preview-validation을 사용할 수 있다.
- 따라서 같은 생성 명령이 네다섯 번째부터 갑자기 다른 commit gate를 타는 threshold cliff를 만들지 않는다.

## 결정 24: visual context는 complex scene의 첫 Decision에만 첨부한다

- transcript를 다시 파싱하지 않고 Object Catalog의 object count, occupied ratio, overlap pair만 계산한다.
- threshold는 한 policy 파일에서 관리하며 현재 기준은 object 5개 이상, occupied ratio 0.28 초과, overlap pair 2개 이상이다.
- simple scene은 기존 Catalog와 bounds만 사용하고 screenshot을 만들지 않는다.
- complex scene은 screenshot을 먼저 준비해 Object Catalog와 같은 strict Decision request에 넣으므로 기본 LLM 호출 수는 1회다.

## 결정 25: screenshot은 layout evidence이며 Object Catalog를 대체하지 않는다

- Catalog handle, kind, content, bounds, capabilities가 object identity와 semantics의 source of truth다.
- screenshot은 whitespace, density, overlap, composition을 판단하는 보조 입력이다.
- model은 page region 또는 catalog object 관계 같은 semantic destination만 선택하며 pixel coordinate나 새로운 handle을 만들지 않는다.
- PDF base, legacy overlay, tldraw full-page export를 최대 1280px PNG로 합성하고 OpenAI에는 low detail image로 전송한다.
- capture가 실패하거나 1.2초 안에 끝나지 않으면 mutation을 막지 않고 Catalog-only Decision으로 내려간다.

## 결정 26: handwriting font는 local OFL asset과 fallback stack으로 구성한다

- Hangul/Latin/숫자는 local `Nanum Pen Script`를 우선 사용한다.
- 빠진 common math glyph는 `STIX Two Math`, `Cambria Math`, cursive fallback으로 보완한다.
- font는 앱에서 preload하되 math layout correctness를 바꾸거나 새 math renderer를 도입하지 않는다.

## 결정 27: write-on은 canonical state와 분리한 create-only presentation이다

- text와 expression object는 처음부터 완성된 content 하나로 TLStore에 commit한다.
- module-local ephemeral start time과 CSS/SVG clip animation만 사용하며 frame마다 tldraw document를 mutation하지 않는다.
- animation duration은 content 길이에 따라 360~1000ms 범위로 제한한다.
- replace/update/delete/load에서는 active reveal을 종료하고 refresh, page revisit, selection, zoom 때문에 재실행하지 않는다.
- `prefers-reduced-motion`에서는 즉시 최종 glyph를 표시하며 animation 실패는 canonical mutation을 rollback하지 않는다.

## 결정 28: tangent의 x/y는 pixel authority가 아니라 typed math 의미다

- selector와 destination의 임의 `x/y`, bounds, runtime id 금지는 그대로 유지한다.
- strict READY step 중 action이 `math.graph.add_tangent`인 정확한 `args.x`와 `args.y` 경로만 범용 좌표 금지에서 제외한다.
- 다른 action의 `args.x/y`와 tangent의 `objectId`, bounds 같은 runtime authority는 계속 초기 parse에서 거절한다.
- tangent tool schema가 number/null과 mode별 필수 조합을 검증하고, runtime이 curve 일관성 및 정확한 미분/접선을 계산한다.

## 결정 29: unqualified graph curve target은 부모 GraphObject 수정이다

- GraphObject의 curve는 catalog에서 참조 가능한 semantic part이지만 별도 tldraw mutation 대상은 아니다.
- `math.graph.add_tangent`와 같은 graph modification이 selector 없는 `curve` part를 받으면 tool boundary에서 같은 handle의 whole GraphObject로 정규화한다.
- point, tangent 또는 index/text가 지정된 qualified part는 의미를 임의로 버리지 않고 계속 거절한다.
- planner에는 graph modification의 기본 target을 `part:null`로 안내하되, runtime은 유효한 curve 응답에도 안전하게 실행된다.
