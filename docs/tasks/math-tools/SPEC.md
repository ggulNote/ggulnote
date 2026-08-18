# 독립 수학 객체/도구 모듈 SPEC

버전: v1

## 1. 목표

꿀노트에서 수학 문제를 종이에 풀듯 생성하고 단계적으로 수정할 수 있도록, 기존 Voice/Note Agent/tldraw runtime과 분리된 수학 도메인 계층을 만든다.

핵심 원칙:

- 작은 수학 객체와 작은 액션을 조합한다.
- LLM은 의도를 선택하고, 좌표·기하·레이아웃 계산은 순수 코드가 담당한다.
- 필산은 사용자의 풀이 기록이며 정답 계산·검증·교정을 하지 않는다.
- 각 객체는 하나의 logical object이고 내부 요소는 child/sub-entity로 다룬다.
- 범용 CAS나 거대한 수식 엔진은 만들지 않는다.

## 2. 전체 단계

- Phase A: Object Model, action contract, serialization, layout/render adapter 뼈대
- Phase B: 수식, 표, 기본 도형, 1차·2차 그래프
- Phase C: 고등학교 함수 그래프 확장, 점, 접선, helper line
- Phase D: 세로 덧셈·뺄셈·곱셈 풀이 레이아웃
- Phase E: 필기형 스타일 검토, Object Catalog projection, Note Agent integration hook

## 3. Completed Milestone - M1 (Phase A)

### 포함

- 독립 `@ggulnote/math-core` workspace package
- 공통 `MathObject` discriminated union
- `MathExpression`, `MathTable`, `MathGraph`, `MathShape`, `ArithmeticLayout` 계약
- 후속 handler가 구현할 세분화된 `math.*` action input 계약과 definition catalog
- versioned serialization/deserialization과 입력 방어
- logical object boundary를 보존하는 layout/render plan
- tldraw custom shape adapter가 소비할 upsert/delete operation 계약
- 순수 함수 단위 테스트

### 제외

- React 컴포넌트 및 실제 tldraw shape 등록
- 수식 렌더러와 편집 UI
- 함수 evaluator, 좌표 sampling, 접선·교점 계산
- 표/도형/필산 geometry 계산 및 action handler
- Voice/Note Agent/Action Registry/Object Catalog 직접 연결
- 기존 Scene Core 타입 변경

## 4. Completed Milestone - M2 (Phase B)

### 포함

- 저장소를 소유하지 않는 expression/table/shape/graph 순수 action handler
- 외부에서 주입하는 object id와 기존 객체를 입력으로 받는 Action Registry 연결 경계
- structured expression node 교체와 plain display fallback
- 일반/함수값/x-y 표 생성, 셀 쓰기, 행·열 삽입과 안정적인 cell id
- 점·선분·직선·반직선·각·기본 다각형·원·호/부채꼴 geometry 검증
- 꼭짓점 라벨과 각/평행/수직 mark 기록
- typed descriptor 기반 1차·2차 함수 evaluator와 deterministic sampling
- expression/table/graph/shape를 SVG primitive로 바꾸는 React 독립 visual model
- `ggulnote-math` tldraw custom shape와 upsert/delete runtime adapter
- 현재 canvas shape util 등록과 `TldrawEditorAdapter.applyMathRenderOperation` 연결 지점

### 제외

- 3차 이상·절댓값·유리·무리·지수·로그·삼각함수 evaluator
- 그래프 점·접선·보조선·교점 action handler
- 필산 action handler와 렌더링
- 직접 편집 UI와 수식 조판 엔진
- Object Catalog 투영 및 Note Agent/Action Registry 등록
- 손그림 스타일 보정

## 5. 후속 기능 범위

- 수식: plain/LaTeX/structured content, 분수, 지수·첨자, 루트, 괄호, 식·연립식
- 표: 일반/함수값/x-y 표, 셀 수정, 행·열 추가
- 그래프: 다항·절댓값·유리·무리·지수·로그·삼각 함수와 원, 점·접선·보조선·교점
- 도형: 점, 선분/직선/반직선, 각, 삼각형/사각형 preset, 원/호/부채꼴/다각형과 라벨·측정 marking
- 필산: add/subtract/multiply의 operand/carry/partial/result/separator/cursor 기록

## 6. 검증

- TypeScript strict typecheck
- serialization/action/handler/geometry/render contract 단위 테스트
- package lint/build
