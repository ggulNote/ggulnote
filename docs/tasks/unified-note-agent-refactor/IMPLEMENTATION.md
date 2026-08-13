# 꿀노트 Unified Note Agent 리팩터링 — 구현 아키텍처

> 문서 목적: 현재 Stage 3·3.5·4에서 구현된 음성 명령, 강건한 PDF Grounding, 공간 배치, Editor Runtime을 버리지 않고 재사용하면서, 자연어 해석 계층을 하나로 합치고 모든 PDF·사용자 생성 객체를 같은 방식으로 검색·참조·배치·수정할 수 있도록 리팩터링한다.

권장 저장 경로:

```text
docs/tasks/unified-note-agent-refactor/IMPLEMENTATION.md
```

이 문서는 해당 리팩터링의 Source of Truth다. 실제 저장소의 `AGENTS.md`와 기존 Stage 문서가 더 높은 우선순위를 갖는 경우, 충돌 내용을 먼저 기록하고 기존 안전 경계를 보존한다.

---

## 0. 현재 기준점

마지막으로 확인된 프로젝트 상태:

```text
branch: feat/stage-4-multimodal-spatial-placement
reported HEAD: 06aa4fdaccaf5a27a9da81bc03b480463a466405
working tree: clean
git diff --check: PASS
```

실제 구현 시작 전 반드시 저장소에서 다시 확인한다.

현재 재사용해야 할 핵심 자산:

```text
Stage 2
- CompletedVoiceTurn
- FrozenVoiceTurnContext
- speech-start 시점 page/focus/sceneRevision freeze
- Voice Lens

Stage 3 / 3.5
- Direct Planner provider/server boundary
- TargetQuery 계열
- TextSpan / SemanticUnit / Object / Relative / Subrange Grounding
- Canonical PDF Text Stream
- Exact / lexical / fuzzy / speech evidence / semantic grounding
- Multi-Rect text range
- Guard / revision / idempotency

Stage 4
- SpatialPlacementQuery 계열
- SpatialSceneSnapshot
- canonical PAGE coordinate
- PlacementProfile / MeasuredDraft
- placement-candidate-engine
- deterministic candidate path
- ambiguous-only bounded multimodal choice
- preview / validation / final guard

Editor Core
- SceneSnapshot / SceneObject / objectById
- CanvasObjectStore / annotation source
- EditorEngine
- CommandManager
- Operation Log
- Undo / Redo
- IndexedDB persistence
```

리팩터링은 위 기능을 다시 만드는 작업이 아니다. **기존 기능을 더 단순한 외부 구조 뒤에 배치하는 작업**이다.

---

# 1. 최종 목표

꿀노트를 다음 구조로 만든다.

```text
Voice Turn
    ↓
One Note Decision LLM
    ↓
Typed Tool Call 또는 Atomic Batch
    ↓
One Note Runtime
    ├─ WorldResolver
    ├─ Optional Compute
    ├─ Optional PlacementEngine
    ├─ Guard
    └─ Transaction / Commit
    ↓
Unified Object World
    ↓
Existing Editor Runtime / IndexedDB / Undo
```

최종 불변식:

```text
One Decision
One Object World
One Spatial Language
One Tool Registry
One Commit Path
```

가장 중요한 책임 분리:

```text
LLM
→ 사용자가 무엇을 원하는지 구조화한다.

WorldResolver
→ 실제 어떤 PDF/Canvas/Object/Range인지 찾는다.

PlacementEngine
→ 실제 어디에 놓을지 계산한다.

Compute Tool
→ 덧셈, 행렬곱, 미분 등 값을 계산한다.

Editor Runtime
→ 검증된 변경만 한 번 commit한다.
```

---

# 2. 왜 현재 구조를 리팩터링하는가

현재 구조에서 자연어 의미가 여러 위치에서 반복 해석될 가능성이 있다.

```text
Direct Planner
→ Normalizer
→ Direct/Spatial Route 판단
→ Target Strategy Router
→ Grounded Recovery
→ Placement 보정
→ 별도 후보 판단
```

이 구조는 다음 문제를 만든다.

```text
- Planner와 Normalizer가 서로 다른 대상을 선택할 수 있음
- 명시적 target과 focus 우선순위가 여러 파일에 흩어짐
- 새 명령을 추가할 때 command union, parser, route, compiler를 함께 수정함
- PDF와 Blank가 서로 다른 경로처럼 보이기 쉬움
- 오류가 발생하면 어느 계층에서 의미가 바뀌었는지 추적하기 어려움
- fallback이 사용자의 명시적 의도를 다른 대상으로 몰래 변경할 수 있음
```

리팩터링 목표는 파일 수를 무조건 줄이는 것이 아니다.

```text
제거 대상
→ 중복된 자연어 의미 해석

유지 대상
→ deterministic grounding, geometry, validation, transaction, undo
```

---

# 3. 설계 원칙

## 3.1 자연어 의미 해석은 한 번만 한다

`One Note Decision LLM`만 다음을 판단한다.

```text
- Tool
- 대상의 의미적 조건
- 새 결과의 목적 위치
- 계산의 입력과 출력 사용 방식
- 단일 호출인지 atomic batch인지
```

Normalizer가 raw transcript를 다시 읽으며 anchor, focus, 위치를 재해석하지 않는다.

Normalizer가 남는다면 다음만 담당한다.

```text
- JSON/schema validation
- unknown field rejection
- enum validation
- nullable/default 정리
- prototype pollution 방어
```

## 3.2 LLM은 실제 ID와 좌표를 만들지 않는다

LLM 출력에서 금지:

```text
objectId
candidateId
rangeId
partId
x / y
left / top / right / bottom
width / height
bounds / rect
offset / tokenId
```

LLM은 선언적 `EntitySelector`와 `Destination`만 만든다.

## 3.3 사용자가 말한 정보만 보존한다

종류, 내용, 위치, 시간, 순서, 속성은 모두 선택적 제약 조건이다.

```text
위치가 없으면 spatial 조건을 만들지 않는다.
시간 표현이 없으면 temporal 조건을 만들지 않는다.
종류가 명시되지 않았으면 억지로 종류를 추가하지 않는다.
```

## 3.4 명시적 대상 실패를 다른 대상으로 바꾸지 않는다

```text
“안녕하세요 아래에 써 줘”
→ 안녕하세요 검색
→ 없으면 NOT_FOUND
```

금지:

```text
안녕하세요 없음
→ focus
→ recent object
→ free space
```

반대로 다음처럼 암묵적 표현인 경우에만 context를 사용한다.

```text
“이거 아래에 써 줘”
→ selection 또는 frozen focus
```

## 3.5 PDF와 Blank는 같은 Agent와 Tool을 사용한다

차이는 route가 아니라 Object capability에 둔다.

```text
PDF base object
→ anchorable / annotatable
→ 원본 editable, movable, deletable은 false

User canvas object
→ anchorable / editable / movable / deletable
```

## 3.6 실패 시 side effect는 0이다

```text
성공
→ 하나의 logical transaction
→ 하나의 undo unit

실패 / ambiguous / stale
→ persistent mutation 0
```

---

# 4. 최종 전체 아키텍처

```text
┌─────────────────────────────────────────────────────────────┐
│ Voice Layer                                                 │
│ CompletedVoiceTurn + Frozen page/focus/sceneRevision        │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ One Note Decision LLM                                       │
│                                                             │
│ transcript + compact frozen context + available tool schema │
│ → CALL | BATCH | NEEDS_INPUT | UNSUPPORTED | NO_OP          │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Note Tool Runtime                                           │
│                                                             │
│ Tool Registry                                               │
│ → input schema validation                                   │
│ → EntitySelector resolve                                    │
│ → optional compute                                          │
│ → optional destination placement                            │
│ → object capability / sceneRevision guard                   │
│ → atomic editor transaction                                 │
└───────────────┬───────────────────────────────┬─────────────┘
                │                               │
                ▼                               ▼
┌────────────────────────────┐     ┌──────────────────────────┐
│ Unified Object World       │     │ Existing Editor Runtime  │
│                            │     │                          │
│ SceneSnapshot              │     │ EditorEngine             │
│ ObjectIndex                │     │ CommandManager           │
│ OperationLedger            │     │ Operation Log            │
│ Spatial geometry           │     │ Undo / Redo              │
│ Object part index          │     │ IndexedDB                │
└────────────────────────────┘     └──────────────────────────┘
```

일반 명령은 다음 경로로 끝나야 한다.

```text
LLM 1회
→ Tool Runtime 로컬 실행
→ Commit
```

두 번째 LLM 호출은 실제 후보가 여러 개이고 deterministic하게 구분되지 않을 때만 허용한다.

---

# 5. Unified Object World

## 5.1 새 Object Model을 병렬로 만들지 않는다

현재 `SceneObject`, `SceneSnapshot`, `CanvasObjectStore`, annotation source를 버리고 별도의 `SceneEntity` 세계를 만들지 않는다.

**기존 `SceneObject`를 canonical entity로 확장하거나, 기존 타입에 metadata view를 합성한다.**

금지:

```text
Existing SceneObject
+ New AgentEntity
+ New SpatialObject

세 개가 서로 다른 source of truth가 되는 구조
```

권장:

```text
Existing SceneObject
→ canonical entity

ObjectIndex
→ SceneObject에서 파생되는 rebuildable index

SpatialSceneObject
→ SceneObject의 placement용 read model
```

## 5.2 모든 사용자 생성 결과는 반드시 Object가 된다

다음은 단순 렌더 결과나 React local state로만 남으면 안 된다.

```text
사용자가 쓴 텍스트
수식
그래프
표
도형
밑줄
하이라이트
접선
그래프의 점/곡선
표의 cell
```

생성 성공 시 최소한 다음이 존재해야 한다.

```text
stable object ID
page ID
kind
source
canonical geometry
render bounds
semantic/search metadata
createdAt / createdByTurnId
capabilities
operation output reference
```

## 5.3 개념적 SceneObject 확장

실제 저장소 naming과 기존 필드를 우선한다.

```ts
type SceneObjectSource =
  | "PDF_BASE"
  | "USER_CANVAS"
  | "USER_ANNOTATION";

type ObjectCapabilities = {
  anchorable: boolean;
  annotatable: boolean;
  editable: boolean;
  movable: boolean;
  resizable: boolean;
  deletable: boolean;
  textRangeAddressable: boolean;
  partAddressable: boolean;
};

type SceneObjectSemantic = {
  searchableText?: string;
  normalizedText?: string;
  canonicalMath?: string;
  semanticLabel?: string;
  attributes?: Readonly<Record<string, unknown>>;
};

type SceneObjectLifecycle = {
  createdAt?: number;
  updatedAt?: number;
  createdByTurnId?: string;
  creationOrder?: number;
  readingOrder?: number;
};

type SceneObjectGeometry = {
  bounds: Rect;
  renderBounds: Rect;
  rects?: readonly Rect[];
};

type SceneObjectPart = {
  partId: string;
  kind: string;
  bounds?: Rect;
  semantic?: SceneObjectSemantic;
  capabilities?: Partial<ObjectCapabilities>;
};

type UnifiedSceneObject = ExistingSceneObject & {
  source: SceneObjectSource;
  geometry: SceneObjectGeometry;
  semantic?: SceneObjectSemantic;
  lifecycle?: SceneObjectLifecycle;
  capabilities: ObjectCapabilities;
  parentId?: string;
  parts?: readonly SceneObjectPart[];
};
```

실제 구현에서 기존 `bounds`, `renderBounds`, `sourceLayer`, `kind`가 이미 있으면 중복 필드를 추가하지 않는다. 필요한 view/adapter만 만든다.

## 5.4 Object capability 예시

PDF paragraph:

```ts
{
  anchorable: true,
  annotatable: true,
  editable: false,
  movable: false,
  resizable: false,
  deletable: false,
  textRangeAddressable: true,
  partAddressable: true
}
```

사용자 Text object:

```ts
{
  anchorable: true,
  annotatable: true,
  editable: true,
  movable: true,
  resizable: true,
  deletable: true,
  textRangeAddressable: true,
  partAddressable: false
}
```

사용자 Graph object:

```ts
{
  anchorable: true,
  annotatable: true,
  editable: true,
  movable: true,
  resizable: true,
  deletable: true,
  textRangeAddressable: false,
  partAddressable: true
}
```

## 5.5 Object source of truth

```text
PDF object
→ PDF/Semantic adapter가 현재 revision의 SceneObject를 구성

Canvas object
→ CanvasObjectStore / editor state가 source of truth

Annotation
→ 기존 annotation persistence가 source of truth

ObjectIndex
→ 위 source에서 파생되는 검색용 index
```

ObjectIndex는 삭제되어도 rebuild 가능해야 한다.

---

# 6. EntityRef — Runtime만 사용하는 실제 참조

LLM은 EntityRef를 생성하지 않는다. Resolver가 실제 Scene에서 만든다.

```ts
type EntityRef =
  | {
      kind: "OBJECT";
      objectId: string;
    }
  | {
      kind: "TEXT_RANGE";
      rangeId: string;
      objectIds: readonly string[];
      rects: readonly Rect[];
    }
  | {
      kind: "OBJECT_PART";
      objectId: string;
      partId: string;
      bounds?: Rect;
    }
  | {
      kind: "PAGE";
      pageId: string;
    };
```

예:

```text
PDF의 A부터 B까지
→ TEXT_RANGE

사용자가 만든 그래프 전체
→ OBJECT

그래프의 두 번째 곡선
→ OBJECT_PART

표의 2행 3열
→ OBJECT_PART
```

---

# 7. EntitySelector — 모든 대상 검색의 공통 언어

## 7.1 선택적 제약조건의 묶음

```ts
type EntitySelector = {
  scope?: "CURRENT_VIEW" | "CURRENT_PAGE" | "DOCUMENT";

  kinds?: readonly string[];

  source?:
    | "PDF_BASE"
    | "USER_CREATED"
    | "ANY";

  content?: {
    text?: string;
    math?: string;
    semantic?: string;
  };

  attributes?: Readonly<Record<string, unknown>>;

  temporal?:
    | "RECENT"
    | "FIRST_CREATED"
    | "LAST_CREATED";

  ordinal?: number | "FIRST" | "LAST";

  context?: "FOCUS" | "SELECTION";

  spatial?: readonly SpatialConstraint[];
};
```

모든 필드를 채울 필요가 없다.

```text
“첫 번째 2차함수 그래프”
→ kind + attributes + ordinal

“오른쪽 위 그래프”
→ kind + spatial

“x²+2x+1=3”
→ content.math

“방금 만든 것”
→ temporal
```

## 7.2 기본 scope 정책

```text
명시적 page/document 표현 없음
→ CURRENT_PAGE

“아까 만든”, “처음 만든”, “문서에서”처럼
현재 페이지를 넘어갈 가능성이 명시됨
→ DOCUMENT

Runtime은 명시된 scope를 몰래 확장하지 않는다.
```

---

# 8. 하나의 공통 Spatial Language

대상 검색과 새 객체 배치가 같은 위치 언어를 사용한다.

## 8.1 공간 관계

```ts
type SpatialRelation =
  | "ABOVE"
  | "BELOW"
  | "LEFT_OF"
  | "RIGHT_OF"
  | "BESIDE"
  | "NEAR"
  | "INSIDE"
  | "OVERLAPS"
  | "BETWEEN"
  | "SAME_ROW"
  | "SAME_COLUMN";
```

`BESIDE`는 무조건 `RIGHT_OF`로 바꾸지 않는다.

```text
BESIDE
→ LEFT_OF와 RIGHT_OF 후보 생성
→ feasible 공간과 정렬로 결정
```

## 8.2 페이지 영역

```ts
type PageRegion =
  | "TOP_LEFT"
  | "TOP"
  | "TOP_RIGHT"
  | "LEFT"
  | "CENTER"
  | "RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM"
  | "BOTTOM_RIGHT"
  | "MARGIN";
```

## 8.3 공간 기준

```ts
type SpatialReference =
  | {
      kind: "ENTITY";
      selector: EntitySelector;
    }
  | {
      kind: "PAGE_REGION";
      region: PageRegion;
    }
  | {
      kind: "FOCUS";
    }
  | {
      kind: "SELECTION";
    };

type SpatialConstraint = {
  relation: SpatialRelation;
  reference: SpatialReference;
};
```

중첩 selector는 최대 깊이 2로 제한한다.

```text
“오른쪽 위에 있는 그래프 아래에 있는 수식”

수식 BELOW (
  그래프 INSIDE TOP_RIGHT
)
```

무제한 재귀나 자유형 predicate language는 만들지 않는다.

## 8.4 검색과 배치의 동일한 의미

```text
“그래프 아래에 있는 수식”
→ 기존 FORMULA가 GRAPH BELOW 조건을 만족하는지 검색

“그래프 아래에 수식을 써 줘”
→ 새 FORMULA의 destination이 GRAPH BELOW
```

---

# 9. Destination — 새 객체와 이동의 위치

```ts
type Destination =
  | {
      kind: "PAGE_REGION";
      region: PageRegion;
      alignment?: "START" | "CENTER" | "END" | "AUTO";
      avoidOverlap?: boolean;
    }
  | {
      kind: "RELATIVE";
      relation: SpatialRelation;
      anchor: EntitySelector | { context: "FOCUS" | "SELECTION" };
      alignment?: "START" | "CENTER" | "END" | "AUTO";
      distance?: "NEAR" | "NORMAL";
      avoidOverlap?: boolean;
    };
```

Create tool에서는 `destination` 자체가 optional이다.

```text
“가나다라 써 줘”
→ destination 없음
→ DefaultPlacementPolicy

“오른쪽 위에 가나다라 써 줘”
→ PAGE_REGION TOP_RIGHT

“안녕하세요 아래에 가나다라 써 줘”
→ RELATIVE BELOW + anchor selector
```

기준 대상 없이 상대 위치만 있는 경우:

```text
“아래에 써 줘”
→ selection
→ frozen focus
→ 둘 다 없으면 NEEDS_INPUT(reference)
```

파괴적 mutation에서는 대상 누락을 임의 default로 처리하지 않는다.

---

# 10. One Note Decision LLM

## 10.1 입력

LLM에 전체 Scene, 전체 PDF, 전체 history, 전체 screenshot을 보내지 않는다.

```ts
type NoteDecisionInput = {
  turn: {
    turnId: string;
    language: string;
    rawFinalTranscript: string;
  };

  frozenContext: {
    documentId: string;
    pageId: string;
    sceneRevision: string | number;
    sceneMode: "pdf" | "blank";

    selection?: {
      kind?: string;
      textPreview?: string;
      semanticPreview?: string;
    };

    focus?: {
      kind?: string;
      textPreview?: string;
      semanticPreview?: string;
    };

    lastOperation?: {
      toolId: string;
      outputKind?: string;
      summary?: string;
    };
  };

  availableTools: readonly CompactToolSchema[];
};
```

`sceneMode`는 별도 route 선택자가 아니라 context 및 capability availability 힌트다.

## 10.2 출력

중앙 command union을 계속 키우지 않는다.

```ts
type NoteToolCall = {
  stepId: string;
  toolId: `${string}.${string}`;
  input: unknown;
};

type NoteDecision =
  | {
      status: "CALL";
      call: NoteToolCall;
    }
  | {
      status: "BATCH";
      atomic: true;
      steps: readonly NoteToolCall[];
    }
  | {
      status: "NEEDS_INPUT";
      missing: readonly string[];
    }
  | {
      status: "UNSUPPORTED";
      reasonCode: string;
    }
  | {
      status: "NO_OP";
    };
```

Batch 제한:

```text
최대 4 steps
무한 loop 없음
각 step은 registry에 존재하는 tool만 사용
이전 step 결과는 명시적 result reference로만 사용
```

개념적 이전 step 참조:

```ts
type StepResultRef = {
  fromStep: string;
  path?: readonly string[];
};
```

## 10.3 Decision 정책

```text
1. 사용자 의도를 가장 직접적으로 표현하는 Tool을 선택한다.
2. 명시적 대상 표현을 EntitySelector에 그대로 보존한다.
3. 위치 표현이 기존 target을 꾸미면 selector.spatial이다.
4. 위치 표현이 새 결과의 목적지면 destination이다.
5. “이거/여기/그거”일 때만 selection/focus를 사용한다.
6. “방금/아까/첫 번째/두 번째”는 temporal/ordinal로 표현한다.
7. 실제 ID, 좌표, offset은 생성하지 않는다.
8. 사용자가 말하지 않은 조건을 임의로 추가하지 않는다.
9. 필요한 Tool이 여러 개면 최대 4개의 atomic batch를 만든다.
10. 자유 텍스트 설명 없이 schema만 반환한다.
```

---

# 11. Dynamic Note Tool Registry

## 11.1 공통 Tool 계약

현재 placement 전용 `VoiceCapability`에 모든 도구를 맞추지 않는다.

```ts
type NoteToolId = `${string}.${string}`;

type NoteToolKind = "QUERY" | "COMPUTE" | "MUTATION";

interface NoteTool<TInput, TOutput> {
  id: NoteToolId;
  kind: NoteToolKind;
  description: string;

  inputSchema: unknown;
  outputSchema: unknown;

  isAvailable(context: NoteToolContext): boolean;

  execute(
    input: TInput,
    context: NoteToolContext
  ): Promise<NoteToolResult<TOutput>>;
}
```

`estimateFootprint`, `validatePlacement`는 모든 Tool의 필수가 아니다.

배치가 필요한 create/move tool만 내부에서 `PlacementEngine`을 사용한다.

## 11.2 Tool surface

초기 production tool:

```text
text.create
text.replace
text.append

annotation.apply
annotation.remove

object.move
object.resize
object.delete
object.style
object.group

navigation.go_to_page
navigation.next_page
navigation.previous_page

history.undo
history.redo
```

수학/그래프/표 확장:

```text
math.add
math.subtract
math.multiply
math.divide
math.matrix_multiply
math.solve
math.differentiate
math.create

graph.create
graph.add_expression
graph.add_point
graph.add_tangent
graph.remove_part

table.create
table.update_cell
table.add_row
table.delete_row
table.merge_cells

shape.create
shape.update
```

## 11.3 Agent Tool과 Editor Primitive를 분리한다

LLM에게 다음처럼 의미가 명확한 Tool을 제공한다.

```text
text.create
graph.create
table.create
math.create
```

Editor 내부에서는 공통 operation으로 내려갈 수 있다.

```text
text.create   ─┐
math.create    │
graph.create   ├→ CreateObjectOperation
table.create   │
shape.create  ─┘
```

금지:

```text
object.create(payload: any)
```

너무 큰 자유형 schema는 Decision 정확도와 검증 가능성을 낮춘다.

## 11.4 확장성 완료 조건

새 Tool을 추가할 때 다음만 수정한다.

```text
- Tool module
- input/output schema
- handler/compiler
- registry registration
- tool tests
- representative decision eval
```

다음은 수정하지 않는 것이 목표다.

```text
- 중앙 Command union
- 중앙 switch
- 자연어 regex normalizer
- PDF/Blank route
- One Note Runtime core
- PlacementEngine core
```

---

# 12. One Note Runtime

## 12.1 일반 mutation 흐름

```text
Typed Tool Call
→ registry lookup
→ strict input validation
→ EntitySelector resolve
→ capability validation
→ optional footprint measurement
→ optional placement
→ sceneRevision / idempotency guard
→ compile existing editor operation
→ atomic commit
→ ObjectIndex / OperationLedger update
→ render visible
```

## 12.2 Mutation Tool이 selector를 직접 받는다

일반 명령을 다음처럼 만들지 않는다.

```text
LLM
→ world.search
→ LLM
→ text.create
```

대신:

```json
{
  "toolId": "text.create",
  "input": {
    "text": "가나다라",
    "destination": {
      "kind": "RELATIVE",
      "relation": "BELOW",
      "anchor": {
        "kinds": ["TEXT"],
        "content": {
          "text": "안녕하세요"
        }
      }
    }
  }
}
```

`text.create` Tool Runtime 내부에서:

```text
WorldResolver
→ PlacementEngine
→ Guard
→ Commit
```

을 수행한다.

이 원칙을 지켜야 일반 명령이 LLM 1회로 끝난다.

## 12.3 Atomic batch

```text
“첫 번째 행렬과 두 번째 행렬을 곱해서 아래에 써 줘”

1. math.matrix_multiply
2. math.create(from step 1 result)
```

전체 batch는:

```text
한 번 commit
한 번 undo
중간 실패 시 persistent mutation 0
```

이어야 한다.

---

# 13. WorldResolver

기존 Stage 3.5 Grounding을 폐기하지 않고 Facade 뒤에 둔다.

```ts
interface WorldResolver {
  resolve(
    selector: EntitySelector,
    context: FrozenWorldContext
  ): Promise<ResolutionResult>;
}
```

```ts
type ResolutionResult =
  | {
      status: "RESOLVED";
      ref: EntityRef;
    }
  | {
      status: "AMBIGUOUS";
      candidates: readonly ResolutionCandidate[];
    }
  | {
      status: "NOT_FOUND";
    }
  | {
      status: "UNSUPPORTED";
      reasonCode: string;
    };
```

## 13.1 Resolver 순서

```text
1. scope
2. kind
3. source/provenance
4. content
   - text exact/normalized/fuzzy
   - canonical math
   - semantic
5. attributes
6. temporal / ordinal
7. spatial constraints
8. deterministic ranking / confidence gate
```

## 13.2 기존 구현 매핑

```text
TextSpan selector
→ 기존 Canonical Text Stream + exact/fuzzy/speech evidence

Semantic selector
→ 기존 semantic/embedding resolver

Object selector
→ 기존 Object Resolver + ObjectIndex metadata

Relative/context selector
→ frozen selection/focus/history

Spatial selector
→ SpatialResolver

Subrange/ObjectPart
→ parent resolve 후 PartResolver
```

## 13.3 Ambiguity

```text
후보 하나
→ RESOLVED

후보 여러 개지만 deterministic 우위 명확
→ RESOLVED

후보 여러 개이고 실제로 구분 불가
→ AMBIGUOUS
```

AMBIGUOUS일 때만 실제 후보 요약을 같은 Decision provider에 한 번 더 전달한다.

별도 자유형 Recovery Agent를 만들지 않는다.

---

# 14. ObjectIndex와 OperationLedger

## 14.1 ObjectIndex

```ts
type ObjectIndexEntry = {
  objectId: string;
  documentId: string;
  pageId: string;

  kind: string;
  source: SceneObjectSource;

  searchableText?: string;
  canonicalMath?: string;
  semanticAttributes?: Readonly<Record<string, unknown>>;

  createdAt?: number;
  updatedAt?: number;
  creationOrder?: number;
  readingOrder?: number;
  createdByTurnId?: string;
};
```

목적:

```text
“아까 만든 그래프”
“첫 번째 2차함수 그래프”
“내가 쓴 안녕하세요”
“두 번째 행렬”
```

ObjectIndex는 persistence source가 아니라 검색 index다.

## 14.2 OperationLedger

```ts
type OperationRecord = {
  operationId: string;
  sourceTurnId: string;
  toolId: NoteToolId;

  inputRefs: readonly EntityRef[];
  outputRefs: readonly EntityRef[];

  createdAt: number;
  undoGroupId: string;
};
```

다음 표현을 처리한다.

```text
방금 만든 것
아까 그은 밑줄
처음 만든 표
그 결과
방금 추가한 접선
```

기존 Operation Log와 CommandManager가 같은 정보를 제공한다면 새 별도 ledger를 만들지 않고 read model adapter를 만든다.

## 14.3 증분 갱신

```text
PDF load
→ PDF object index 생성

Object create/update/delete
→ 해당 index entry만 갱신

Math object update
→ canonicalMath/attributes 갱신

Graph update
→ expression/degree/part index 갱신

Commit
→ operation output refs 기록
```

명령 시점에 전체 문서를 매번 재인덱싱하지 않는다.

---

# 15. SpatialResolver와 PlacementEngine

## 15.1 공간 관계는 미리 전부 저장하지 않는다

다음 관계를 모든 객체 쌍에 저장하지 않는다.

```text
A below B
A near C
A right of D
```

객체 이동 시 stale해지기 때문이다.

현재 canonical geometry에서 필요할 때 계산한다.

```text
BELOW
→ candidate.top >= reference.bottom
→ 수평 overlap 또는 중심 정렬 확인

ABOVE
→ candidate.bottom <= reference.top

RIGHT_OF
→ candidate.left >= reference.right
→ 수직 overlap 확인

BESIDE
→ LEFT_OF 또는 RIGHT_OF 후보

INSIDE TOP_RIGHT
→ center 또는 주요 bounds가 page region 내부

NEAR
→ normalized rect distance
```

객체 수가 실제 병목이 되기 전에는 현재 페이지 Rect 순회로 시작한다.

## 15.2 PlacementEngine은 기존 Stage 4를 Facade로 감싼다

```ts
interface PlacementEngine {
  resolve(input: {
    destination?: Destination;
    draft: MeasuredDraft;
    snapshot: SpatialSceneSnapshot;
  }): Promise<PlacementResult>;
}
```

내부에서 기존 구현 재사용:

```text
SpatialSceneSnapshot
PlacementProfile
MeasuredDraft
placement-candidate-engine
hard filter / dedupe / dominance / diversity
ambiguous-only multimodal choice
preview validation
final guard
```

## 15.3 기본 위치

Create tool의 destination이 없을 때만 사용한다.

```text
1. explicit insertion/caret가 있으면 사용
2. editable viewport의 deterministic default free-space
3. 사용 가능한 안전 공간이 없으면 NO_FEASIBLE_PLACEMENT
```

최근 객체나 focus를 destination으로 임의 사용하지 않는다.

## 15.4 사용자가 만든 Object도 동일한 Anchor다

```text
그래프 아래에 텍스트
내가 쓴 텍스트 옆에 그래프
방금 만든 밑줄 아래에 메모
표 오른쪽에 수식
```

모두 anchor Object의 `renderBounds` 또는 `rects`를 기준으로 처리한다.

---

# 16. PDF와 Blank의 통합

## 16.1 같은 것

```text
One Note Decision
EntitySelector
Spatial Language
Tool Registry
WorldResolver
PlacementEngine
Guard
Transaction
Undo
ObjectIndex interface
```

## 16.2 다른 것

```text
PDF Adapter
→ PDF/Semantic object 생성
→ 원본 immutable
→ word/line/paragraph range 제공

Canvas Adapter
→ user object 생성
→ editable/movable/deletable
→ renderer geometry 제공
```

코드 곳곳에서 금지:

```ts
if (sceneMode === "pdf") {
  // 별도 command route
} else {
  // 별도 command route
}
```

권장:

```ts
if (!target.capabilities.movable) {
  return TARGET_NOT_MOVABLE;
}
```

## 16.3 Text Range 공통 계약

PDF와 사용자 Text 모두 동일한 Tool을 사용하려면:

```ts
interface TextRangeAddressable {
  resolveTextRange(query: {
    quote?: string;
    start?: string;
    end?: string;
  }): Promise<EntityRef>;
}
```

구현:

```text
PDF Adapter
→ 기존 Canonical Text Stream

Canvas Text Adapter
→ renderer glyph/character layout
```

Agent는 차이를 알지 않는다.

---

# 17. Math / Graph / Table

## 17.1 수식 Object

수식은 표시 문자열뿐 아니라 canonical representation을 갖는다.

```text
x² + 2x + 1 = 3
x^2+2x+1=3
엑스 제곱 더하기 이 엑스 더하기 일은 삼
```

모두 동일한 canonical math/AST로 검색할 수 있어야 한다.

```text
speech/text
→ math normalization
→ canonical AST/expression
→ Formula Object search
```

## 17.2 Compute와 Create 분리

```text
math.matrix_multiply
→ 값 계산, 화면 mutation 없음

math.create
→ 계산 결과를 Formula/Math Object로 화면에 생성
```

따라서 다음을 같은 compute tool로 처리할 수 있다.

```text
행렬곱만 해 줘
행렬곱 결과를 읽어 줘
행렬곱 결과를 아래에 써 줘
```

## 17.3 Graph Object Part

```text
Graph Object
├─ curve
├─ point
├─ tangent
├─ axis
└─ label
```

예:

```text
첫 번째 2차함수 그래프의 두 번째 곡선
방금 만든 접선
x=1인 지점
```

## 17.4 Table Object Part

```text
Table Object
├─ row
├─ column
└─ cell
```

예:

```text
표의 2행 3열
첫 번째 열
마지막 행
```

ObjectPart는 parent Object의 stable part ID를 사용하며, LLM은 실제 part ID를 생성하지 않는다.

---

# 18. Tool Result와 오류 모델

```ts
type NoteToolResult<T> =
  | {
      status: "SUCCESS";
      data: T;
    }
  | {
      status: "AMBIGUOUS";
      candidates: readonly ResolutionCandidate[];
    }
  | {
      status: "NOT_FOUND";
    }
  | {
      status: "NEEDS_INPUT";
      missing: readonly string[];
    }
  | {
      status: "NOT_ALLOWED";
      reasonCode: string;
    }
  | {
      status: "NO_FEASIBLE_PLACEMENT";
    }
  | {
      status: "STALE_SCENE";
    }
  | {
      status: "FAILED";
      reasonCode: string;
    };
```

권장 reason code:

```text
INVALID_DECISION
UNKNOWN_TOOL
INVALID_TOOL_INPUT
TARGET_NOT_FOUND
TARGET_AMBIGUOUS
TARGET_NOT_EDITABLE
TARGET_NOT_MOVABLE
TARGET_NOT_DELETABLE
TARGET_NOT_ANNOTATABLE
REFERENCE_REQUIRED
TANGENT_POINT_REQUIRED
NO_FEASIBLE_PLACEMENT
STALE_SCENE
DUPLICATE_TURN
COMPUTE_FAILED
COMPILE_FAILED
COMMIT_FAILED
ABORTED
```

---

# 19. 레이턴시 설계

일반 경로:

```text
STT Final
→ Decision LLM 1회
→ local resolver/placement/guard
→ commit
```

지켜야 할 조건:

```text
- 전체 Scene을 LLM에 보내지 않는다.
- 전체 PDF text를 LLM에 보내지 않는다.
- 전체 history를 LLM에 보내지 않는다.
- screenshot은 기본 경로가 아니다.
- mutation Tool이 selector와 destination을 직접 받는다.
- ObjectIndex는 증분 갱신한다.
- LLM 출력은 설명문 없이 schema만 반환한다.
```

추가 호출:

```text
AMBIGUOUS
→ 실제 후보 3~6개만 같은 provider에 전달
→ 최대 1회

VISUAL_REQUIRED
→ Stage 4 후보 crop/mark만 전달
→ 최대 1회
```

목표는 평균뿐 아니라 p95 tail latency를 줄이는 것이다.

---

# 20. Diagnostics와 Eval

## 20.1 Trace

```ts
type NoteAgentTrace = {
  turnId: string;
  pageId: string;
  sceneRevision: string | number;

  decisionStartedAt: number;
  decisionCompletedAt: number;
  llmCallCount: number;
  toolCallCount: number;

  resolverMs: number;
  computeMs: number;
  placementMs: number;
  guardMs: number;
  commitMs: number;
  renderMs: number;

  usedDisambiguation: boolean;
  usedVision: boolean;

  resultStatus: string;
  errorCode?: string;
};
```

개인정보와 문서 원문 전체는 기본 로그에 저장하지 않는다.

## 20.2 Decision eval

최소 대표 명령:

```text
1. 가나다라 써 줘
2. 오른쪽 위에 가나다라 써 줘
3. 안녕하세요 아래에 가나다라 써 줘
4. 내가 쓴 안녕하세요 옆에 그래프 그려 줘
5. 그래프 아래에 있는 수식을 지워 줘
6. 오른쪽 위에 있는 그래프 아래 수식 옆에 풀이 써 줘
7. 방금 만든 밑줄 아래에 중요하다고 써 줘
8. Moreover부터 instance까지 밑줄 쳐 줘
9. 첫 번째 2차함수 그래프에 x=1 접선 그어 줘
10. 첫 번째 행렬과 두 번째 행렬을 곱해서 아래에 써 줘
11. 표의 2행 3열을 10으로 바꿔 줘
12. 이거 지워 줘
13. 지워 줘 — selection 없음
14. 명시한 target이 없음
15. duplicate target ambiguity
16. stale scene
17. PDF base move/delete 금지
18. Blank user object move/delete 허용
19. 복합 3-step atomic batch
20. Undo 한 번
```

평가 기준:

```text
- 올바른 toolId
- 명시적 조건 보존
- target selector와 destination 구분
- 실제 object ID/coordinate 미생성
- 올바른 object resolve
- 잘못된 silent fallback 없음
- 최종 Scene 결과
- one undo
- failure side effect 0
- LLM call count
```

---

# 21. 3개 Phase 리팩터링 계획

너무 잘게 나누지 않고 세 Phase로 진행한다.

---

## Phase 1 — Unified Object World Foundation

목표:

```text
모든 PDF·Canvas·Annotation·사용자 생성 결과를
기존 SceneObject 기반의 검색·참조 가능한 Object로 통합한다.
```

구현:

```text
1. 현재 branch/HEAD/working tree와 실제 타입 경로 조사
2. 새 branch refactor/unified-note-agent 생성
3. docs/tasks/unified-note-agent-refactor/IMPLEMENTATION.md 배치
4. STATUS.md 생성
5. 기존 SceneObject를 canonical entity로 확장
6. source / render geometry / semantic metadata / lifecycle / capabilities 정렬
7. PDF, Canvas, Annotation adapter 정렬
8. 사용자 Text/Annotation이 stable SceneObject로 존재하는지 보장
9. ObjectIndex read model 구현
10. 기존 Operation Log adapter 또는 OperationLedger read model 구현
11. UnifiedObjectWorld facade 구현
12. PDF/Blank 공통 query fixture
13. 기존 Stage 3.5/4/Editor regression
```

하지 않음:

```text
- 새 Decision LLM production cutover
- 기존 Direct/Spatial route 삭제
- 새 Math/Graph/Table production capability
- 새 VLM
```

Phase 1 완료 조건:

```text
- PDF 문단, 사용자 텍스트, 밑줄, 하이라이트가 같은 lookup API에 존재
- 모든 객체에 canonical geometry와 capability 존재
- user-created object를 createdAt/turnId/kind/text로 찾을 수 있음
- ObjectIndex 삭제 후 rebuild 가능
- PDF/Blank가 같은 UnifiedObjectWorld interface 사용
- 기존 기능 회귀 없음
```

---

## Phase 2 — One Decision + Tool Runtime Shadow Mode

목표:

```text
자연어를 한 번만 구조화하고,
기존 Grounding/Placement/Editor를 NoteTool 뒤에서 재사용한다.
```

구현:

```text
1. EntitySelector / SpatialConstraint / Destination 계약
2. NoteDecision strict schema
3. NoteTool / NoteToolRegistry
4. WorldResolver facade
5. PlacementEngine facade
6. 기존 기능 Tool adapter
   - text.create / text.replace
   - annotation.apply
   - navigation.*
   - history.undo
   - 기존 구현이 있으면 object.move/delete/style
7. One Note Decision provider
   - 기존 same-origin/server-only AI boundary 재사용
8. NoteRuntime
9. CALL / atomic BATCH / common result contract
10. shadow mode
    - 기존 route 결과와 새 decision/runtime 결과 비교
    - 새 path는 기본적으로 실제 commit하지 않음
11. decision / resolver / placement eval
12. latency trace
```

하지 않음:

```text
- 기존 route 제거
- natural-language normalizer 즉시 삭제
- 모든 미래 tool 한 번에 구현
```

Phase 2 완료 조건:

```text
- 대표 명령에서 새 path가 올바른 tool/selector/destination 생성
- 일반 명령 LLM 1회
- 기존 Stage 3.5 fuzzy grounding 재사용
- 기존 Stage 4 placement engine 재사용
- 명시적 target > context 정책 통과
- user-created object anchor가 PDF object와 동일하게 작동
- old/new 결과 parity 리포트 생성
```

---

## Phase 3 — Production Cutover / Cleanup / Extensibility Proof

목표:

```text
새 Runtime을 production 기본 경로로 전환하고,
중복 자연어 해석 계층을 제거하며,
Tool 추가만으로 기능이 확장됨을 검증한다.
```

구현:

```text
1. feature flag 기반 gradual cutover
2. 실제 mutation을 NoteRuntime 한 경로로 통합
3. ambiguity candidate-only second pass
4. Stage 4 visual candidate 선택은 진짜 필요한 경우만 유지
5. 기존 자연어 Normalizer를 schema validator로 축소
6. Direct/Spatial 의미 route 분기 제거 또는 thin compatibility adapter로 축소
7. 고정 DIRECT_COMMAND_NAMES / 중앙 command switch 단계적 제거
8. fixed CapabilityId union을 namespaced ToolId registry로 일반화
9. 대표 확장 Tool 구현
   - math.add
   - math.matrix_multiply
   - math.create 또는 현재 renderer가 없으면 명확한 unsupported boundary
10. Graph/Table/Math object/part 계약과 registry extension test
11. full E2E / regression / undo / persistence / latency
12. deprecated code 제거 후 docs/status COMPLETE
```

Phase 3 완료 조건:

```text
- production 자연어 의미 해석 주체가 One Note Decision 하나
- PDF/Blank 별 Planner 없음
- user object와 PDF object에 동일 spatial command 사용
- 새 Tool 추가 시 central command union/route 수정 없음
- 일반 path LLM 1회
- ambiguity/VLM 각각 최대 1회
- one transaction / one undo
- failure side effect 0
```

---

# 22. 권장 모듈 경계

실제 repository 구조를 우선하고, 기존 파일을 무리하게 대이동하지 않는다.

개념적 경계:

```text
apps/web/src/features/voice/
├─ note-agent/
│  ├─ domain/
│  │  ├─ entity-selector.ts
│  │  ├─ spatial-language.ts
│  │  ├─ destination.ts
│  │  ├─ note-decision.ts
│  │  └─ note-tool-result.ts
│  │
│  ├─ decision/
│  │  ├─ note-decision-provider.ts
│  │  ├─ note-decision-schema.ts
│  │  └─ note-decision-policy.ts
│  │
│  ├─ runtime/
│  │  ├─ note-runtime.ts
│  │  ├─ note-transaction.ts
│  │  └─ note-runtime-guard.ts
│  │
│  ├─ world/
│  │  ├─ unified-object-world.ts
│  │  ├─ world-resolver.ts
│  │  ├─ object-index.ts
│  │  ├─ operation-ledger.ts
│  │  ├─ spatial-resolver.ts
│  │  └─ object-part-resolver.ts
│  │
│  └─ tools/
│     ├─ registry.ts
│     ├─ text/
│     ├─ annotation/
│     ├─ object/
│     ├─ math/
│     ├─ graph/
│     └─ table/
│
packages/editor-core/src/scene-core/
├─ existing types / snapshot / coordinate
├─ object metadata/capability extension
└─ object index adapter if editor-core ownership이 맞는 경우
```

`PlacementEngine`은 기존 Stage 4 파일을 가능한 그대로 사용하고 facade/adapters만 추가한다.

---

# 23. 제거 또는 축소 대상

새 구조가 eval과 production parity를 통과한 뒤에만 제거한다.

```text
- raw transcript를 다시 해석하는 normalizeTextPlacementIntent 계열
- regex anchor extraction
- Planner 결과의 의미를 heuristic으로 변경하는 코드
- Direct Route와 Spatial Route의 별도 자연어 의미 해석
- 명시적 target 실패 후 focus/recent/free-space cascade
- 별도 자유형 Grounded Recovery Agent
- 별도 Placement Agent
- 고정 DIRECT_COMMAND_NAMES
- 중앙 거대 DirectEditorCommand union
- PDF/Blank별 Planner
- 항상 호출되는 VLM
```

유지:

```text
- strict schema parser
- frozen sceneRevision
- exact/fuzzy grounding
- semantic grounding
- canonical geometry
- placement candidate engine
- preview validation
- capability guard
- transaction
- editor runtime
- undo/idempotency
```

---

# 24. 대표 동작 예시

## 24.1 사용자 Text 기준 생성

명령:

```text
내가 쓴 안녕하세요 아래에 가나다라 써 줘
```

Decision:

```json
{
  "status": "CALL",
  "call": {
    "stepId": "s1",
    "toolId": "text.create",
    "input": {
      "text": "가나다라",
      "destination": {
        "kind": "RELATIVE",
        "relation": "BELOW",
        "anchor": {
          "kinds": ["TEXT"],
          "source": "USER_CREATED",
          "content": {
            "text": "안녕하세요"
          }
        },
        "avoidOverlap": true
      }
    }
  }
}
```

Runtime:

```text
ObjectIndex / Scene resolve
→ 실제 Text Object
→ renderBounds
→ Stage 4 BELOW candidates
→ guard
→ text.create commit
```

## 24.2 사용자 Graph 기준 생성

```text
첫 번째 2차함수 그래프 옆에 식을 써 줘
```

```text
graph selector:
- kind GRAPH
- degree 2
- ordinal FIRST

destination:
- BESIDE graph selector
```

## 24.3 위치로 기존 대상 검색

```text
오른쪽 위에 있는 그래프 아래 수식을 지워 줘
```

```text
target selector:
- kind FORMULA
- BELOW reference GRAPH
- reference GRAPH spatial INSIDE TOP_RIGHT
```

## 24.4 사용자 Annotation 기준 생성

```text
방금 만든 밑줄 아래에 중요하다고 써 줘
```

```text
anchor selector:
- kind ANNOTATION
- annotationType UNDERLINE
- temporal RECENT
```

## 24.5 PDF Text Range

```text
Moreover부터 instance까지 밑줄 쳐 줘
```

```text
annotation.apply
→ 기존 TextSpan exact/fuzzy resolver
→ TEXT_RANGE Rect[]
→ 하나의 annotation / one undo
```

## 24.6 Math batch

```text
첫 번째 행렬과 두 번째 행렬을 곱해서 두 번째 행렬 아래에 써 줘
```

```text
s1 math.matrix_multiply
s2 math.create(from s1, BELOW second matrix)
```

---

# 25. 최종 Definition of Done

```text
[ ] 자연어 의미 해석은 One Note Decision 한 곳에서만 수행
[ ] 기존 SceneObject가 canonical entity이며 병렬 object model 없음
[ ] PDF / Canvas / Annotation을 같은 UnifiedObjectWorld에서 조회
[ ] 모든 사용자 생성 결과가 stable Object/Part로 저장됨
[ ] 사용자 Object도 target, anchor, spatial reference가 됨
[ ] EntitySelector의 모든 조건은 optional
[ ] 대상 검색과 배치가 같은 Spatial Language 사용
[ ] LLM은 실제 ID/좌표/offset을 생성하지 않음
[ ] 기존 Stage 3.5 fuzzy/TextSpan Grounding 재사용
[ ] 기존 Stage 4 candidate/preview/validation 재사용
[ ] PDF/Blank 차이는 Adapter와 capability에만 존재
[ ] Dynamic Tool Registry로 새 기능 추가
[ ] 일반 명령 LLM 1회
[ ] ambiguity second pass 최대 1회
[ ] visual fallback 최대 1회
[ ] 성공은 one transaction / one undo
[ ] 실패는 persistent side effect 0
[ ] ObjectIndex rebuild 가능
[ ] Operation output ref로 과거 사용자 객체 검색 가능
[ ] 대표 command eval과 latency trace 존재
[ ] old route 제거 전 parity 검증 완료
```

---

# 26. 한 문장 최종 정의

> 꿀노트는 PDF와 사용자가 만든 모든 결과를 하나의 구조화된 Object World로 보고, 하나의 Decision LLM이 선언적 Tool Call을 만들며, 실제 대상·위치·계산·수정은 deterministic Runtime이 처리하는 범위 제한형 Note Agent다.

---

# 27. Phase 1 실제 저장소 정렬 결정

2026-08-13 조사 결과 다음 실제 구조를 Phase 1 기준으로 채택한다.

```text
branch base
→ feat/stage-4.5-accuracy-improvements @ fc61be5
→ 사용자 확인 후 refactor/unified-note-agent 생성

canonical object
→ packages/editor-core SceneObject 유지
→ 별도 AgentEntity를 만들지 않음
→ source/capability/semantic/lifecycle/render geometry는
   SceneObject에서 계산되는 SceneObjectMetadataView로 제공

production user object source
→ EditorEngine / SerializedAnnotation / PageSceneSnapshot
→ 기존 IndexedDB pageSnapshots가 source of truth
→ CanvasObjectStore는 Scene Core generic store이며 별도 production DB로 승격하지 않음

spatial read model
→ 기존 SpatialSceneObject 유지
→ SceneObject.renderBounds가 있으면 사용하고 없으면 canonical bounds 사용

search index
→ SceneObject snapshot에서 파생되는 in-memory RebuildableObjectIndex
→ revision + content hash로 invalidation
→ rebuild 및 create/update/delete delta API 제공
→ IndexedDB table 추가 없음

operation history
→ 기존 EditorOperation에 optional sourceTurnId/toolId와 generated undoGroupId 추가
→ 기존 CommandManager / publishOperation / IndexedDB operations 경로 유지
→ DirectCommandHistoryContext의 성공 record를 read-only OperationLedger adapter로 변환
```

Annotation schema는 기존 v1에 optional additive field를 추가한다.

```text
createdByTurnId
creationOrder
targetObjectIds
```

기존 `bounds`/`rects`와 함께 같은 `SerializedAnnotation` 및 page snapshot에 저장되므로
새 DB migration은 필요 없다. legacy record는 그대로 hydrate되고, 없는
`createdByTurnId`는 추정하거나 backfill하지 않는다. `creationOrder`가 없는 legacy
Canvas object는 index view에서 기존 `createdAt`을 ordering fallback으로 사용한다.

Phase 1은 One Note Decision provider, EntitySelector production resolution, Tool Registry
cutover, Direct/Spatial route 제거, Math/Graph/Table production capability를 연결하지 않는다.

---

# 28. Phase 2 실제 저장소 정렬 결정

2026-08-13 Phase 2는 다음 실제 구조를 채택한다.

```text
decision provider
→ 기존 DirectTextModelTransport와 server-only OpenAI transport 재사용
→ same-origin /api/voice/note-decision
→ compact context + dynamic available-tool schema

world resolution
→ Phase 1 ExistingUnifiedObjectWorld / ObjectIndex 사용
→ PDF TextSpan/semantic/object resolution은 FrozenTargetResolver adapter로 재사용
→ explicit target miss는 context/history로 대체하지 않음

placement
→ 기존 Stage 4 profile/measurement/candidate/deterministic gate 재사용
→ Phase 2 shadow에는 별도 preview/commit 구현 없음
→ production old route가 기존 preview/final guard를 계속 소유

shadow ownership
→ NEXT_PUBLIC_NOTE_AGENT_SHADOW_MODE=1에서만 enabled
→ old Direct/Spatial route가 유일한 commit owner
→ NoteRuntime에는 Editor commit port를 주입하지 않음
→ shadow failure는 trace하되 old route 결과를 막지 않음

tool surface
→ text.create / text.replace / annotation.apply
→ navigation.next_page / navigation.previous_page / history.undo
→ generic object move/delete/style과 Graph/Math/Table은 stable compiler가 없어 미노출
```

Phase 2 trace는 bounded in-memory read model이다. real model/network parity 및 latency
sample과 production analytics persistence는 Phase 3 cutover 전 검토 항목으로 남긴다.
기존 Direct Planner, natural placement normalizer, fixed command union, Direct/Spatial route는
Phase 2에서 삭제하거나 production default로 대체하지 않는다.
