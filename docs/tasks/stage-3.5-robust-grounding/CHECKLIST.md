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

- [ ] Target Strategy Router
- [ ] Relative resolver는 Stage 3 정책 재사용
- [ ] TextSpan resolver를 Canonical Text Stream 기반으로 전환/확장
- [ ] SemanticUnit resolver에 embedding evidence 추가
- [ ] Object resolver의 type/metadata/history evidence 정리
- [ ] Subrange parent-first contract
- [ ] query kind별 evidence weight/config
- [ ] 모든 target에 같은 global scoring 강제하지 않음
- [ ] semantic query embedding lifecycle
- [ ] PageTargetCatalog/Embedding index 연결
- [ ] RESOLVED/AMBIGUOUS/NOT_FOUND reason 정리
- [ ] Stage 3 Disambiguator compatibility 유지
- [ ] query-specific resolver tests
- [ ] semantic retrieval tests
- [ ] object/history regression
- [ ] Phase C 문서 갱신

완료 조건:

```text
TargetQuery.kind에 따라 적절한 grounding 전략이 선택되고,
semantic query는 embedding evidence를 실제로 사용할 수 있어야 한다.
```

---

# Phase D. Typed Speech Normalization

## D1. Raw Evidence

- [ ] Raw Final Transcript 보존
- [ ] normalization이 raw를 overwrite하지 않음
- [ ] optional ASR alternatives 연결 가능 contract

## D2. Document Term / English Phonetic

- [ ] Document Lexicon source 정의
- [ ] 실제 page/document term만 후보화
- [ ] 한국어식 영어 음차 hypothesis interface
- [ ] lexical/fuzzy와 결합
- [ ] 필요 시 LLM Recovery가 최종 판단
- [ ] 자유 영어 rewrite를 authoritative target으로 사용하지 않음

## D3. Number

- [ ] integer
- [ ] decimal
- [ ] percent
- [ ] sequence
- [ ] power
- [ ] 문맥별 ambiguity 유지

## D4. Math

- [ ] 기존 Math AST/model 조사
- [ ] spoken number/operator normalization
- [ ] MathNormalizationResult contract
- [ ] 지원 범위 tests
- [ ] 미지원 구조는 가짜 AST 생성 금지

## D5. Optional STT Bias

- [ ] 현재 STT provider가 contextual keyword/prompt를 지원하는지 확인
- [ ] 지원 시 bounded terms 제공
- [ ] 지원 안 해도 core grounding 동작

완료 조건:

```text
영어 음차/숫자/수식 발화가 raw transcript를 잃지 않고
typed grounding evidence로 제공되어야 한다.
```

---

# Phase E. Grounded LLM Recovery

- [ ] 기존 Disambiguator와 공통화 가능성 조사
- [ ] recoverable NOT_FOUND reason 정의
- [ ] non-recoverable reason 정의
- [ ] Recovery call max 1
- [ ] SemanticUnit candidate-only recovery
- [ ] TextSpan start/end anchor recovery
- [ ] Object candidate-only recovery
- [ ] Subrange supported selector recovery
- [ ] internal ID LLM 비노출
- [ ] coordinate/offset LLM 생성 금지
- [ ] capability/operation/relation/payload 변경 금지
- [ ] NONE 결과 no mutation
- [ ] Frozen page/revision 강제
- [ ] Stage 3 Guard 재검증
- [ ] targetRecoveryUsed diagnostics
- [ ] recovery latency
- [ ] actual `헨타이어 ↔ entire` fixture
- [ ] actual `모얼오벌 ↔ Moreover`, `인스탠스 ↔ instance` fixture
- [ ] target absent hallucination safety test
- [ ] normal RESOLVED path 추가 LLM call 0
- [ ] Phase E 문서 갱신

완료 조건:

```text
deterministic grounding이 실패해도 실제 Frozen Scene 후보/anchor에만
grounded된 LLM fallback으로 안전하게 복구할 수 있어야 한다.
```

---

# Phase F. Multi-Rect Execution / E2E / Completion

## F1. Editor Core

- [ ] existing multi-rect/grouped annotation capability 재조사
- [ ] generic multi-rect annotation model 또는 minimal extension
- [ ] Voice-specific editor API 만들지 않음
- [ ] serialization
- [ ] hydration/refresh restore
- [ ] update/delete semantics
- [ ] one logical operation
- [ ] one Undo unit
- [ ] Redo 기존 semantics

## F2. Integration

- [ ] ResolvedTextSpan Rect[] → underline
- [ ] ResolvedTextSpan Rect[] → highlight
- [ ] PDF immutable
- [ ] operation log
- [ ] turnId exactly-once regression
- [ ] REVISE_LAST/CONTINUE regression

## F3. Final E2E

- [ ] "여기 밑줄"
- [ ] "AI 문제점 설명한 문장"
- [ ] "헨타이어 프로세스 들어간 문장 하이라이트"
- [ ] "모얼오벌부터 인스탠스까지 밑줄"
- [ ] multi-line range
- [ ] Canvas semantic memo
- [ ] numeric normalization
- [ ] supported math normalization
- [ ] target 없음 → no commit
- [ ] ambiguous → bounded recovery
- [ ] stale scene → no commit
- [ ] spatial → DEFER_SPATIAL

## F4. Evaluation

- [ ] Intent accuracy
- [ ] Target Hit@1
- [ ] Anchor accuracy
- [ ] Range correctness / Rect coverage
- [ ] Recovery success
- [ ] False Commit Rate
- [ ] NONE precision
- [ ] p50/p95 latency 측정 가능
- [ ] embedding cache hit diagnostics
- [ ] LLM fallback rate
- [ ] Undo integrity

## F5. Completion

- [ ] Stage 3.5 full regression
- [ ] Stage 3 regression
- [ ] Web full tests
- [ ] Editor Core full tests
- [ ] typecheck
- [ ] lint
- [ ] `git diff --check`
- [ ] STATUS COMPLETE
- [ ] Stage 4 handoff 기록

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
