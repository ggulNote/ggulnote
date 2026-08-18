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
