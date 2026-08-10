# Stage 3.5 — Robust Multigranular Grounding: SPEC

## 0. 목표

Stage 3.5는 완료된 Stage 3 Direct Command Route 위에
**다중 단위 Target Grounding + semantic embedding + speech normalization + grounded recovery + exact multi-line text range**를 추가한다.

핵심 파이프라인:

```text
CompletedVoiceTurn
        ↓
Direct Planner (Stage 3 재사용)
        ↓
CommandPlan + TargetQuery
        ↓
Target Strategy Router
        ↓
Query-specific Resolver
        │
        ├─ Relative
        ├─ TextSpan
        ├─ SemanticUnit
        ├─ Object
        └─ Subrange
        ↓
Grounding Evidence
        ├─ Canonical Text Stream
        ├─ Exact/Lexical/Fuzzy
        ├─ Embeddings
        ├─ Semantic Structure
        ├─ Focus/Selection
        ├─ History/Temporal
        ├─ Typed Speech Hypotheses
        └─ Structured Object Data
        ↓
RESOLVED | AMBIGUOUS | RECOVERABLE_NOT_FOUND | UNSUPPORTED
        ↓ 필요한 경우만
Grounded LLM Recovery
        ↓
ResolvedTarget
        ↓
Stage 3 Guard
        ↓
Stage 3 Capability Compiler / Executor
```

Stage 3의 안전 경계와 Editor Runtime을 유지한다.

## Layered TextSpan Grounding

TextSpan strategy는 exact Canonical fast path 이후 다음 내부 계층을 사용한다.

```text
AnchorSlotNormalizer
-> HybridAnchorRetriever
-> seed-based MultiTokenAnchorResolver
-> AnchorOccurrenceResolver
-> SpanPairBuilder
-> SpanPairRanker
-> Confidence Gate
-> optional Grounded LLM Pair Judge
-> RangeMaterializer
```

- Single-token과 multi-token anchor는 같은 `AnchorSpanCandidate` 모델을 사용한다.
- Phrase candidate는 실제 Frozen Page의 연속 Canonical token span만 허용한다.
- Speech chunk coverage와 monotonic phrase alignment를 별도 evidence로 유지한다.
- Cross-line phrase는 같은 semantic paragraph의 reading order에서 허용하며, paragraph/column
  경계를 넘는 synthetic phrase stitching은 금지한다.
- Start/end occurrence는 forward/materializable `SpanPairCandidate`로 먼저 조합한다.
- Pair policy는 anchor confidence, sentence/paragraph structure, distance, focus와 geometry를
  함께 사용한다. 긴 range는 distance만으로 제거하지 않는다.
- High-confidence pair는 deterministic resolve하고, 낮은 margin만 bounded `P* | NONE`
  Recovery를 최대 1회 사용한다.
- Grounding은 annotation operation과 독립적이며 existing Guard/Compiler/Editor를 재사용한다.

---

# 1. 범위

## 포함

```text
Canonical Page Text Stream
Reading order / token-to-bounds mapping
Exact multi-line TextSpan materialization
Multi-Rect ResolvedTextSpan

Sentence/Paragraph embeddings
Canvas text/memo embeddings
IndexedDB embedding persistence
EmbeddingStore abstraction
sourceRevision/contentHash invalidation

Query-specific Resolver Strategy
Semantic embedding evidence
Document lexicon / term hypotheses
한국어식 영어 발음 recovery
Number typed normalization
Math normalization contract / structured hypotheses

Grounded LLM Recovery
Target-kind-specific recovery schema
AMBIGUOUS / recoverable NOT_FOUND fallback

Multi-rect underline/highlight
하나의 logical Undo unit

Diagnostics / evaluation
```

## 제외

```text
Stage 4 Screenshot/VLM
Spatial Placement
Occupancy Map / Free-space Candidate

새 Table/Graph/Math 편집 capability 자체
대규모 Math OCR/Ink recognition model
자율 ReAct/Tool Agent
새 Undo Stack
새 Editor Runtime
PDF source mutation
서버 Vector DB migration
```

---

# 2. 시작 조건 / 브랜치

이번 Stage 3.5 작업은 사용자 실행 결정에 따라 Stage 3 완료 branch를 직접 기준점으로 사용한다.

새 브랜치:

```text
feat/stage-3.5-robust-grounding
```

실제 기준점:

```text
source branch: feat/stage-3-direct-command-route
Stage 3 source HEAD: e90efe6
Stage 3.5 branch: feat/stage-3.5-robust-grounding
Stage 3.5 base: e90efe6
develop used: NO
```

Stage 3 `STATUS.md`의 `COMPLETE`와 working tree를 확인하고, develop checkout/merge/cherry-pick 없이 진행한다.

---

# 3. 권장 모듈 경계

기존 구조를 우선한다.

개념적으로:

```text
voice/
├─ domain/
│  ├─ target-query.ts
│  ├─ resolved-target.ts
│  ├─ grounding-evidence.ts
│  ├─ speech-hypothesis.ts
│  └─ target-recovery.ts
│
├─ application/
│  ├─ target-strategy-router.ts
│  ├─ text-span-resolver.ts
│  ├─ semantic-unit-resolver.ts
│  ├─ object-target-resolver.ts
│  ├─ subrange-resolver.ts
│  ├─ grounded-target-recovery.ts
│  └─ typed-speech-normalizer.ts
│
└─ providers/
   ├─ embedding-provider.ts
   └─ target-recovery-provider.ts
```

Text/Semantic index가 voice feature보다 Editor/Semantic Core에 더 자연스럽다면 공용 package에 둔다.

Voice feature 안에 PDF parsing/indexing을 복제하지 않는다.

---

# 4. Canonical Page Text Stream

## 4.1 목적

TextSpan은 Sentence boundary와 무관하게 정확한 start/end 범위를 resolve해야 한다.

예:

```text
"Moreover부터 instance까지"
```

따라서 페이지의 실제 reading order를 canonical sequence로 제공한다.

## 4.2 개념 타입

```ts
type CanonicalTextToken = {
  id: string;
  pageId: PageId;

  text: string;
  normalizedText: string;

  readingOrder: number;

  sourceObjectId?: SceneObjectId;

  paragraphId?: string;
  sentenceId?: string;
  lineId?: string;

  bounds: Rect;

  charStart?: number;
  charEnd?: number;
};

type PageTextStream = {
  documentId: DocumentId;
  pageId: PageId;
  sceneRevision: SceneRevision;
  indexVersion: number;

  tokens: readonly CanonicalTextToken[];
};
```

실제 Semantic Layer의 타입/ID/offset을 최대한 재사용한다.

가짜 char offset을 만들지 않는다.

---

# 5. TextSpan Target

개념:

```ts
type TextAnchorQuery = {
  raw: string;
  normalizedHint?: string;
};

type TextSpanTargetQuery = {
  kind: "text_span";
  quote?: string;
  startAnchor?: TextAnchorQuery;
  endAnchor?: TextAnchorQuery;
};
```

Planner가 actual token ID/offset을 만들지 않는다.

---

# 6. TextSpan Resolver Strategy

처리 순서:

```text
1. exact anchor
2. normalized exact
3. lexical/fuzzy
4. document term hypotheses
5. AMBIGUOUS / RECOVERABLE_NOT_FOUND
6. grounded anchor recovery
```

두 anchor가 resolve되면:

```text
readingOrder(start) <= readingOrder(end)
```

를 검증하고 실제 range를 materialize한다.

동일 anchor가 여러 번 등장하면 structure/focus evidence를 사용하고,
그래도 불명확하면 AMBIGUOUS다.

---

# 7. Multi-Rect ResolvedTextSpan

개념:

```ts
type ResolvedTextSpan = {
  kind: "text_span";

  pageId: PageId;
  sceneRevision: SceneRevision;

  source: "pdf" | "ggulnote";

  text: string;

  startTokenId?: string;
  endTokenId?: string;

  bounds: readonly Rect[];

  editable: boolean;
  annotatable: boolean;

  provenance: {
    strategy: string;
    recoveryUsed: boolean;
  };
};
```

여러 line에 걸치는 span은 line별 actual bounds를 유지한다.

---

# 8. Multi-Rect Annotation

Underline/Highlight는 `Rect[]`를 하나의 논리 작업으로 처리해야 한다.

실제 Editor Core 표현은 backward compatibility를 위해 `bounds`를 selection용 union
rect로 유지하고, `UNDERLINE`/`HIGHLIGHT`에 ordered optional `rects`를 추가한다.
`rects`가 없으면 기존 single-rect annotation이며, 있으면 annotation object 하나가
모든 line geometry를 소유한다. serialization schema v1과 IndexedDB store는 additive
field를 그대로 보존하므로 DB migration 없이 legacy snapshot을 hydrate한다.

우선순위:

```text
1. 기존 multi-rect annotation primitive 재사용
2. 기존 grouped command/transaction 재사용
3. 없으면 generic editor-core multi-rect/group primitive 최소 추가
```

금지:

```text
Voice layer에서 여러 annotation을 따로 만들고 Undo 여러 번 요구
```

Serialization / refresh restore도 하나의 논리 annotation으로 유지한다.

---

# 9. Embedding Record

```ts
type EmbeddingGranularity =
  | "sentence"
  | "paragraph"
  | "canvas_text"
  | "memo";

type EmbeddingRecord = {
  id: string;

  documentId: DocumentId;
  pageId: PageId;

  sourceType: "pdf" | "ggulnote";
  sourceObjectId: string;
  sourceRevision: number;

  granularity: EmbeddingGranularity;

  contentHash: string;

  embeddingModel: string;
  dimensions: number;
  vector: Float32Array;

  createdAt: number;
};
```

TypedArray/ArrayBuffer 저장 방식은 IndexedDB와 현재 persistence abstraction에 맞춘다.

---

# 10. Embedding Storage

## 10.1 Interface

```ts
interface EmbeddingStore {
  put(record: EmbeddingRecord): Promise<void>;

  getBySource(
    documentId: DocumentId,
    sourceObjectId: string
  ): Promise<EmbeddingRecord | null>;

  getByPage(
    documentId: DocumentId,
    pageId: PageId,
    granularity?: EmbeddingGranularity
  ): Promise<readonly EmbeddingRecord[]>;

  deleteBySource(
    documentId: DocumentId,
    sourceObjectId: string
  ): Promise<void>;
}
```

필요하면 batch API를 추가한다.

## 10.2 현재 구현

```text
IndexedDB
```

기존 persistence/database wrapper가 있으면 재사용한다.

별도 IndexedDB connection 체계를 병렬로 만들지 않는다.

---

# 11. Embedding Provider

```ts
interface EmbeddingProvider {
  embed(
    texts: readonly string[],
    options?: { signal?: AbortSignal }
  ): Promise<readonly Float32Array[]>;
}
```

모델명/API key는 domain에 하드코딩하지 않는다.

현재 OpenAI server boundary가 있다면 같은 server-only 원칙을 따른다.

환경 설정 개념:

```text
EMBEDDING_MODEL
```

---

# 12. PDF Embedding Generation

Semantic model이 안정화된 뒤:

```text
PDF page
→ sentence/paragraph objects
→ contentHash
→ existing embedding cache 확인
→ missing/stale만 batch embed
→ IndexedDB
```

동일 content/version이면 다시 호출하지 않는다.

---

# 13. Canvas Text Embedding Lifecycle

대상 예:

```text
TEXT annotation
Memo
text-bearing canvas object
```

작성 중:

```text
dirty
```

작성 완료/blur/debounce:

```text
embedding refresh
```

내용 변경:

```text
sourceRevision/contentHash mismatch
→ stale
→ refresh
```

삭제:

```text
embedding invalid/delete
```

현재 Stage 3의 history/undo를 우회하지 않는다.

---

# 14. Semantic Unit Resolver

입력:

```text
SemanticUnitTargetQuery
```

예:

```text
"AI의 문제점을 설명하는 문장"
```

evidence:

```text
unit/type
lexical
fuzzy
semantic embedding
structural
focus
```

Query embedding은 필요한 경우 한 번 생성한다.

현재 Frozen Page의 matching granularity vector와 cosine similarity를 계산한다.

---

# 15. Object Resolver

ObjectTarget은:

```text
type match
text-bearing metadata
embedding (있는 경우)
temporal/history
focus
structure
```

를 사용한다.

Graph/Table/Equation은 구조화 metadata가 embedding보다 강한 evidence일 수 있다.

---

# 16. Relative Resolver

RelativeTarget은 기존 Stage 3 정책을 우선한다.

```text
focused
last_target
recent
```

Embedding은 기본적으로 사용하지 않는다.

Stage 3 history/revision/idempotency semantics를 그대로 재사용한다.

---

# 17. Subrange Resolver

기본 원칙:

```text
parent target resolve
→ parent 구조 내부 selector resolve
```

예:

```text
EquationObject → Math term
TableObject → row/cell
Paragraph → last N lines
```

현재 구조화 모델이 없는 selector를 가짜로 지원하지 않는다.

---

# 18. Speech Hypotheses

```ts
type TermHypothesis = {
  raw: string;
  candidates: readonly {
    text: string;
    source: "document_lexicon" | "normalizer" | "llm_recovery";
    confidence?: number;
  }[];
};

type NumberHypothesis =
  | { kind: "integer"; value: number }
  | { kind: "decimal"; value: number }
  | { kind: "sequence"; values: readonly number[] }
  | { kind: "power"; base: number | string; exponent: number }
  | { kind: "percent"; value: number };

type SpeechGroundingEvidence = {
  rawFinalTranscript: string;
  termHypotheses?: readonly TermHypothesis[];
  numberHypotheses?: readonly NumberHypothesis[];
};
```

Raw transcript를 대체하지 않는다.

---

# 19. Document Lexicon

현재 Frozen Page/Document에 실제 존재하는:

```text
영어 term
전문용어
약어
수식 label
named entity
```

를 bounded lexicon으로 만들 수 있다.

```ts
type DocumentTerm = {
  surface: string;
  normalized: string;
  pageIds: readonly PageId[];
  sourceObjectIds: readonly string[];
};
```

초기 구현에서 복잡한 phoneme model을 강제하지 않는다.

---

# 20. Number Normalizer

문맥에 따라 typed candidates를 제공한다.

```text
"이십삼" → 23
"이 점 삼" → 2.3
"이의 삼승" → 2^3
"이십삼 퍼센트" → 23%
```

모든 숫자 발화를 하나의 문자열로 강제 변환하지 않는다.

---

# 21. Math Normalizer

```ts
type MathNormalizationResult = {
  raw: string;
  normalizedText?: string;
  ast?: MathAst;
  confidence?: number;
};
```

현재 프로젝트에 Math AST가 있으면 재사용한다.

없다면 거대한 CAS/Math parser를 새로 만들지 않는다.

---

# 22. Grounded Recovery Trigger

기존 `AMBIGUOUS` / `NOT_FOUND` reason을 이용해:

```text
recoverable reason
→ recovery

non-recoverable reason
→ terminal
```

로 분기한다.

Recovery 가능한 예:

```text
TEXT_NO_MATCH
SEMANTIC_NO_MATCH
LOW_SEMANTIC_CONFIDENCE
ASR_TERM_MISMATCH
```

Recovery 금지:

```text
STALE_SCENE
TARGET_KIND_UNSUPPORTED
MISSING_FOCUS_REQUIRED
PERMISSION
SPATIAL_REQUIRED
```

---

# 23. Grounded Recovery Provider

```ts
interface GroundedTargetRecoveryProvider {
  recover(
    input: GroundedTargetRecoveryInput,
    options?: { signal?: AbortSignal }
  ): Promise<GroundedTargetRecoveryResult>;
}
```

기존 Stage 3 disambiguator provider를 일반화해 재사용할 수 있으면 우선한다.

---

# 24. SemanticUnit Recovery

입력:

```text
Raw STT
TargetQuery
Frozen Page candidate summaries C1..Cn
```

출력:

```text
C1..Cn | NONE
```

실제 internal ID는 application mapping에만 존재한다.

---

# 25. TextSpan Anchor Recovery

입력:

```text
Raw STT
TextSpan TargetQuery
Frozen Page Text Stream
bounded start anchor candidates
bounded end anchor candidates
```

출력:

```ts
type TextSpanRecoveryResult =
  | {
      status: "SELECTED";
      startLabel: string;
      endLabel: string;
    }
  | {
      status: "NONE";
    };
```

선택된 label을 실제 token으로 매핑한 뒤 range는 코드가 계산한다.

---

# 26. Recovery Call Budget

일반 성공 경로:

```text
Planner LLM 1회
Resolver
→ 성공
```

Recovery 경로:

```text
Planner LLM 1회
Resolver
→ ambiguous/recoverable failure
Grounded Recovery LLM 최대 1회
```

무한 agent loop 금지.

---

# 27. Diagnostics

추가 추적:

```text
targetStrategy
embeddingUsed
embeddingQueryMs?
embeddingCandidateCount?
speechNormalizationUsed
targetRecoveryUsed
targetRecoveryKind?
targetRecoveryMs?
rangeRectCount?
```

기존 Stage 3 trace/privacy 정책을 유지한다.

---

# 28. 테스트 시나리오

## Relative

```text
"여기 밑줄"
→ 기존 focus resolver
```

## Semantic

```text
"AI 문제점을 설명하는 문장"
→ sentence embedding
→ correct semantic candidate
```

## ASR English phonetic

```text
Actual: "The entire process..."
STT: "헨타이어 프로세스 들어간 문장"
→ semantic/recovery
→ correct sentence
```

## TextSpan English phonetic

```text
Actual anchors: Moreover ... instance
STT: "모얼오벌부터 인스탠스까지"
→ actual anchors
→ multi-line range
```

## Canvas semantic

```text
Canvas text:
"역전파의 핵심은 연쇄법칙"

Command:
"역전파 설명한 메모"
→ canvas embedding candidate
```

## Number

```text
spoken numeric forms
→ typed hypothesis
```

## Math

```text
"엑스 제곱 더하기 삼 엑스"
→ structured normalization where supported
```

## Safety

```text
document에 실제 target 없음
→ NONE / no mutation
```

## Stage 4 boundary

```text
"오른쪽 빈 곳에 메모"
→ DEFER_SPATIAL
```

---

# 29. 완료 기준

Stage 3.5 완료 시:

```text
Canonical Text Stream 존재
TextSpan start/end anchor를 실제 range로 resolve
multi-line Rect[] 생성 가능
multi-rect annotation이 one logical undo unit

PDF sentence/paragraph embedding cache
Canvas text/memo embedding lifecycle
IndexedDB persistence + abstraction

Target kind별 resolver strategy
Semantic embedding evidence 활성화

영어 한국어식 음차 오류를 실제 문서 후보에 grounded recovery
숫자 typed normalization
Math normalization contract

Stage 3 history/idempotency/guard regression 없음
Stage 4 spatial scope 침범 없음
```

이 증명되어야 한다.

## Hardened Speech Grounding Pipeline

Raw STT -> optional bounded Speech Refiner -> Planner -> TargetQuery -> target-slot extraction -> complete Frozen Page term index -> query-specific hybrid retrieval -> deterministic resolver -> optional grounded candidate recovery -> Guard -> Compiler -> Editor.

The Refiner receives only the bounded utterance, language, and command vocabulary. It never receives PDF text, canvas content, IDs, geometry, or vectors. Target-aware retrieval strips TextSpan boundary particles by slot role, excludes command words structurally, keeps actual page surfaces as authority, and applies the LLM candidate bound only after local retrieval.
