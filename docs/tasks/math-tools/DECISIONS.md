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
