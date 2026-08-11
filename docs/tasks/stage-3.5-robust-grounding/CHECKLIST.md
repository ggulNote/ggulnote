# Stage 3.5 — Robust Multigranular Grounding: CHECKLIST

## 사용법

- `[ ]` 미완료
- `[x]` 완료
- 완료 시 `STATUS.md`에 commit/test/limitation 기록
- Stage 3 완료 구조를 대규모 리팩터링하지 않는다.
- Stage 4 Spatial/VLM 구현을 시작하지 않는다.

---

# Phase 0. Preflight / Branch

- [x] 현재 branch / HEAD / working tree 확인
- [x] Stage 3 STATUS가 COMPLETE인지 확인
- [x] 사용자 결정에 따라 develop을 기준점으로 사용하지 않음
- [x] `AGENTS.md` 재독
- [x] Stage 3 DECISIONS/SPEC/CHECKLIST/STATUS 재독
- [x] 기존 Stage 3 targeted/full tests baseline 확인
- [x] 기존 IndexedDB/persistence abstraction 조사
- [x] existing Semantic Layer/reading order/offset 구조 조사
- [x] existing annotation serialization/undo/grouping 조사
- [x] 기존 embedding/AI server/provider 존재 여부 재조사
- [x] 기존 변경 보존, reset/clean/stash 금지
- [x] `feat/stage-3-direct-command-route` @ `e90efe6` 기준 branch 생성

완료 조건:

```text
현재 세션 기준:
- Stage 3 COMPLETE는 문서에서 확인
- 현재 base/head는 feat/stage-3-direct-command-route @ e90efe6
- develop은 소스 분기로 사용하지 않음
```

---

# Phase A. Canonical Text Stream / Exact Range Foundation

- [x] 기존 Semantic Layer의 paragraph/sentence/line/word 관계 조사
- [x] 실제 reading order Source of Truth 결정
- [x] existing text offset/word membership 재사용
- [x] `CanonicalTextToken` 또는 대응 adapter 정의
- [x] 대응 `CanonicalTextStream` view 정의
- [x] PDF page → canonical stream adapter 구현
- [x] frozen page/scene revision과 semantic source version 추적
- [x] token → line/paragraph/sentence 관계 추적
- [x] token → actual bounds 추적
- [x] 가짜 offset 생성 금지
- [x] exact anchor lookup
- [x] normalized exact anchor lookup
- [x] duplicate anchor 처리 정책
- [x] start/end order validation
- [x] range token materialization
- [x] line별 Rect[] materialization
- [x] `ResolvedTextSpan` multi-rect 확장
- [x] focused/single-unit Stage 3 regression 유지
- [x] canonical stream unit tests
- [x] multi-line range tests
- [x] duplicate/missing anchor tests
- [x] Phase A STATUS/CHECKLIST 갱신

완료 조건:

```text
실제 page text에서 start/end anchor가 주어지면
LLM 없이 정확한 token range + Rect[]를 만들 수 있어야 한다.
```

---

# Phase B. Embedding / IndexedDB Search Index

## B1. Storage Contract

- [x] `EmbeddingRecord` 정의
- [x] granularity 정의
- [x] contentHash/sourceRevision/version 정의
- [x] `EmbeddingStore` interface
- [x] 기존 persistence abstraction 위 IndexedDB 구현
- [x] typed vector persistence 검증
- [x] stale embedding 판정
- [x] delete/invalidation
- [x] migration/version 정책

## B2. Provider

- [x] server-side embedding provider boundary
- [x] browser secret 노출 없음
- [x] batch embedding
- [x] AbortSignal
- [x] error normalization
- [x] embedding model config
- [x] unit tests에서 actual network 호출 없음

## B3. PDF Indexing

- [x] Sentence embedding
- [x] Paragraph embedding
- [x] semantic analysis 후 missing/stale만 생성
- [x] duplicate API 호출 방지
- [x] IndexedDB 재사용
- [x] page-level loading/search API

## B4. Canvas Indexing

- [x] Canvas editable text 대상 결정: `TEXT`
- [x] Memo 대상 결정: 별도 type 없음, `TEXT`만 지원
- [x] Editor operation commit + debounce lifecycle
- [x] edit → stale → refresh
- [x] delete → invalid/delete
- [x] Undo/Redo와 contentHash 정합성
- [x] non-text canvas object를 억지 embedding하지 않음

## B5. Similarity

- [x] cosine similarity utility
- [x] page scope filter
- [x] granularity filter
- [x] Top-K deterministic ranking
- [x] 최종 threshold/weight는 Phase C 책임으로 유지
- [x] embedding unavailable 시 editor/Stage 3 비의존 fallback

완료 조건:

```text
PDF sentence/paragraph 및 지원 Canvas text가
IndexedDB에 versioned embedding으로 저장되고
Frozen Page semantic retrieval에 사용 가능해야 한다.
```

---

# Phase C. Query-Specific Resolver Strategies

- [x] Target Strategy Router
- [x] Relative resolver는 Stage 3 정책 재사용
- [x] TextSpan resolver를 Canonical Text Stream 기반으로 전환/확장
- [x] SemanticUnit resolver에 embedding evidence 추가
- [x] Object resolver의 type/metadata/history evidence 정리
- [x] Subrange parent-first contract
- [x] query kind별 evidence weight/config
- [x] 모든 target에 같은 global scoring 강제하지 않음
- [x] semantic query embedding lifecycle
- [x] PageTargetCatalog/Embedding index 연결
- [x] RESOLVED/AMBIGUOUS/NOT_FOUND reason 정리
- [x] Stage 3 Disambiguator compatibility 유지
- [x] query-specific resolver tests
- [x] semantic retrieval tests
- [x] object/history regression
- [x] Phase C 문서 갱신

완료 조건:

```text
TargetQuery.kind에 따라 적절한 grounding 전략이 선택되고,
semantic query는 embedding evidence를 실제로 사용할 수 있어야 한다.
```

---

# Phase D. Typed Speech Normalization

## D1. Raw Evidence

- [x] Raw Final Transcript 보존
- [x] normalization이 raw를 overwrite하지 않음
- [x] optional ASR alternatives 연결 가능 contract

## D2. Document Term / English Phonetic

- [x] Document Lexicon source 정의
- [x] 실제 page/document term만 후보화
- [x] 한국어식 영어 음차 hypothesis interface
- [x] lexical/fuzzy와 결합
- [ ] 필요 시 LLM Recovery가 최종 판단
- [x] 자유 영어 rewrite를 authoritative target으로 사용하지 않음

## D3. Number

- [x] integer
- [x] decimal
- [x] percent
- [x] sequence
- [x] power
- [x] 문맥별 ambiguity 유지

## D4. Math

- [x] 기존 Math AST/model 조사
- [x] spoken number/operator normalization
- [x] MathNormalizationResult contract
- [x] 지원 범위 tests
- [x] 미지원 구조는 가짜 AST 생성 금지

## D5. Optional STT Bias

- [x] 현재 STT provider가 contextual keyword/prompt를 지원하는지 확인
- [x] 지원 시 bounded terms 제공
- [x] 지원 안 해도 core grounding 동작

완료 조건:

```text
영어 음차/숫자/수식 발화가 raw transcript를 잃지 않고
typed grounding evidence로 제공되어야 한다.
```

---

# Phase E. Grounded LLM Recovery

- [x] 기존 Disambiguator와 공통화 가능성 조사
- [x] recoverable NOT_FOUND reason 정의
- [x] non-recoverable reason 정의
- [x] Recovery call max 1
- [x] SemanticUnit candidate-only recovery
- [x] TextSpan start/end anchor recovery
- [x] Object candidate-only recovery
- [ ] Subrange supported selector recovery
- [x] internal ID LLM 비노출
- [x] coordinate/offset LLM 생성 금지
- [x] capability/operation/relation/payload 변경 금지
- [x] NONE 결과 no mutation
- [x] Frozen page/revision 강제
- [x] Stage 3 Guard 재검증
- [x] targetRecoveryUsed diagnostics
- [x] recovery latency
- [x] browser production composition에 same-origin HTTP Recovery provider 연결
- [x] development bounded Direct Command trace 노출
- [x] actual `헨타이어 ↔ entire` fixture
- [x] actual `모얼오벌 ↔ Moreover`, `인스탠스 ↔ instance` fixture
- [x] target absent hallucination safety test
- [x] normal RESOLVED path 추가 LLM call 0
- [x] Phase E 문서 갱신

완료 조건:

```text
deterministic grounding이 실패해도 실제 Frozen Scene 후보/anchor에만
grounded된 LLM fallback으로 안전하게 복구할 수 있어야 한다.
```

---

# Phase F. Multi-Rect Execution / E2E / Completion

## F1. Editor Core

- [x] existing multi-rect/grouped annotation capability 재조사
- [x] generic multi-rect annotation model 또는 minimal extension
- [x] Voice-specific editor API 만들지 않음
- [x] serialization
- [x] hydration/refresh restore
- [x] update/delete semantics
- [x] one logical operation
- [x] one Undo unit
- [x] Redo 기존 semantics

## F2. Integration

- [x] ResolvedTextSpan Rect[] → underline
- [x] ResolvedTextSpan Rect[] → highlight
- [x] PDF immutable
- [x] operation log
- [x] turnId exactly-once regression
- [x] REVISE_LAST/CONTINUE regression

## F3. Final E2E

- [x] "여기 밑줄"
- [x] "AI 문제점 설명한 문장"
- [x] "헨타이어 프로세스 들어간 문장 하이라이트"
- [x] "모얼오벌부터 인스탠스까지 밑줄"
- [x] multi-line range
- [ ] Canvas semantic memo
- [x] numeric normalization
- [x] supported math normalization
- [x] target 없음 → no commit
- [x] ambiguous → bounded recovery
- [x] stale scene → no commit
- [x] spatial → DEFER_SPATIAL

## F4. Evaluation

- [x] Intent accuracy
- [x] Target Hit@1
- [x] Anchor accuracy
- [x] Range correctness / Rect coverage
- [x] Recovery success
- [x] False Commit Rate
- [x] NONE precision
- [x] p50/p95 latency 측정 가능
- [x] embedding cache hit diagnostics
- [x] LLM fallback rate
- [x] Undo integrity

## F5. Completion

- [x] Stage 3.5 full regression
- [x] Stage 3 regression
- [x] Web full tests
- [x] Editor Core full tests
- [x] typecheck
- [x] lint
- [x] `git diff --check`
- [x] STATUS COMPLETE
- [x] Stage 4 handoff 기록

Stage 3.5 완료 조건:

```text
다중 단위 Target Grounding
+ exact multi-line range
+ semantic embedding
+ typed speech normalization
+ grounded LLM recovery
+ transactional multi-rect annotation
```

이 Stage 3 Direct Route와 통합되어야 한다.

## Speech Understanding / Target Grounding Hardening

- [x] Preserve raw transcript and add bounded, non-authoritative Speech Refiner
- [x] Use same-origin server provider with graceful raw fallback
- [x] Build speech evidence after Planner from TargetQuery slots
- [x] Remove TextSpan boundary particles by slot role
- [x] Prevent command-word fragments from entering term retrieval
- [x] Search the complete Frozen Page term universe before candidate bounding
- [x] Merge exact, normalized, fuzzy, phonetic, and ASR evidence
- [x] Keep semantic retrieval in query-specific SemanticUnit/Object strategies
- [x] Rank contextual terms by relevance instead of alphabetical truncation
- [x] Preserve candidate-only bounded Grounded Recovery
- [x] Add Candidate Recall@K evaluation and multilingual recall fixtures
- [x] Wire Refiner and Recovery providers into browser production composition

## TextSpan Grounding Architecture Hardening

- [x] Single-token/multi-token anchor를 공통 `AnchorSpanCandidate`로 표현한다.
- [x] Target slot의 `부터`/`까지`를 role-aware하게 정규화한다.
- [x] Hybrid token seed 주변만 query-length 기반으로 동적 phrase 확장한다.
- [x] Phrase alignment와 speech chunk coverage를 분리해 평가한다.
- [x] Actual Canonical token occurrence와 semantic paragraph boundary를 유지한다.
- [x] Valid forward/materializable `SpanPairCandidate`만 생성한다.
- [x] Pair ranking policy와 confidence/margin을 중앙화한다.
- [x] TextSpan Recovery를 bounded pair label `P* | NONE` contract로 전환한다.
- [x] Reverse/out-of-page/synthetic pair를 Recovery 전에 제거한다.
- [x] Anchor/Pair/Final/False Commit 평가 지표를 분리한다.
- [x] Vision capability, multi-token end/both, duplicate, long range, cross-line 및 multi-column tests를 추가한다.
- [x] Canonical/Recovery/Pipeline/Multi-Rect/Stage 3 regression을 유지한다.
- [x] Query-relative anchor boundary evidence와 same-occurrence canonicalization을 적용한다.
- [x] Start/end evidence inheritance, duplicate/dominated pair pruning과 confidence gate를 적용한다.
- [x] Pair Recovery에 supplied-label-only/NONE 정책을 유지한 bounded alignment summary를 제공한다.
- [x] Anchor boundary accuracy, deterministic resolution rate와 LLM recovery rate를 평가한다.
- [x] Retrieval hit와 query-relative supported chunk alignment를 분리한다.
- [x] Weak retrieval hit가 full coverage로 승격되지 않도록 monotonic one-to-one alignment를 적용한다.
- [x] Rich anchor evidence를 pair ranking까지 보존하고 weakest-anchor confidence를 반영한다.
- [x] Recovery projection을 non-dominated compact pair 최대 4개로 제한한다.
- [x] bilingual multi-token deterministic path와 genuine duplicate one-call recovery를 검증한다.
- [x] Strong seed 주변 contiguous phrase에서 absolute/joint support로 page-relative phrase recall 회귀를 방지한다.
