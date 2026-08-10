# Stage 3.5 — Robust Multigranular Grounding: STATUS

## 1. 현재 상태

```text
Stage: 3.5 — Robust Multigranular Grounding
Status: COMPLETE
Phase A: COMPLETE
Phase B: COMPLETE
Phase C: COMPLETE
Phase D: COMPLETE
Phase E: COMPLETE
Phase F: COMPLETE
Current Milestone: COMPLETE / READY FOR STAGE 4
```

`FrozenTargetResolver` facade는 기존 동기 API를 유지하고 production planning용
async strategy router를 사용한다. Typed speech evidence는 turn context에서 한 번
생성되며 recoverable `NOT_FOUND`만 bounded candidate-only LLM recovery로 보강한다.
`ResolvedTextSpan.bounds`는 generic multi-rect annotation 하나로 commit되어 operation과
Undo/Redo도 하나의 logical unit을 유지한다.

## 2. Branch / 기준점

```text
source branch: feat/stage-3-direct-command-route
Stage 3 source HEAD: e90efe6
Stage 3 status: COMPLETE
Stage 3.5 branch: feat/stage-3.5-robust-grounding
Stage 3.5 base: e90efe6
develop used: NO
Phase A implementation: 9c66c23
Phase B implementation: 49f8497
Phase A/B docs: a3eb4a9
Phase C implementation: 322466a
Phase C docs: a84a3d0
Phase D implementation: e9ff07f
Phase D docs: 4b86f7c
Phase D compatibility fix: 3019cf4
Phase E implementation: cd91576
Phase E docs: 930fc48
Phase F editor implementation: edb5faa
Phase F voice integration/evaluation: 2180383
```

## 3. Phase A

- `PageSemanticModel.getAllByReadingOrder()`를 canonical source로 재사용한다.
- 실제 semantic WORD를 우선 token으로 사용하고 없으면 LINE으로 fallback한다.
- 기존 `sourceRanges` offset만 사용하며 synthetic offset을 만들지 않는다.
- exact/normalized anchor, duplicate `AMBIGUOUS`, reverse `NO_FORWARD_SPAN`을 지원한다.
- sentence/paragraph/column 경계를 넘는 실제 token range를 materialize한다.
- 선택 token을 실제 line별 bounds union으로 변환해 `ResolvedTextSpan.bounds: Rect[]`를 만든다.
- multi-rect Editor mutation은 Phase F 범위로 남아 있다.

## 4. Persistence / Embedding Store

- 기존 Dexie DB `ggulnote-local`을 재사용한다.
- DB version은 semantic cache v2에서 embedding store v3으로 증가한다.
- `embeddings` object store를 추가하고 기존 documents/semantic/page snapshot/operation 데이터를 유지한다.
- `IndexedDbEmbeddingStore`가 application/domain의 `EmbeddingStore` 계약을 구현한다.
- vector는 `Float32Array`로 structured clone하며 JSON number array로 저장하지 않는다.
- document 삭제 시 해당 embedding도 같은 기존 persistence transaction에서 삭제한다.

`EmbeddingRecord` metadata:

```text
documentId / pageId
sourceType / sourceObjectId / sourceRevision
granularity
contentHash
embeddingModel / dimensions
Float32Array vector
createdAt
```

cache reuse 조건은 contentHash, sourceRevision, model, dimensions, vector length가 모두 일치하는 경우다.

## 5. Provider / Server Boundary

- browser contract: `HttpEmbeddingProvider`
- same-origin route: `/api/voice/embeddings`
- server provider: `OpenAiEmbeddingProvider`
- server config: `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_DIMENSIONS`
- browser에 API key를 노출하지 않는다.
- batch, internal chunking, AbortSignal, timeout, HTTP/config/count/dimension 오류 정규화를 지원한다.
- production log에 vector, PDF/Canvas 원문, raw API payload, key를 남기지 않는다.
- actual external network smoke는 실행하지 않았다.

## 6. PDF / Canvas Index

PDF:

- 실제 semantic `SENTENCE`와 `PARAGRAPH`만 indexing한다.
- WORD/LINE을 embedding하지 않는다.
- Unicode NFKC + whitespace normalization과 input version으로 contentHash를 만든다.
- semantic extractor/schema/source signature로 sourceRevision을 결정한다.
- missing/stale object만 한 batch로 생성하고 동일 page/content in-flight 요청을 dedupe한다.

Canvas:

- 현재 별도 Memo domain type이 없으므로 text-bearing `TEXT` annotation만 `canvas_text`로 지원한다.
- annotation `updatedAt`을 sourceRevision으로 사용한다.
- `CanvasEmbeddingIndexCoordinator`는 Editor operation commit 후 debounce해 현재 page snapshot을 indexing한다.
- edit/undo/redo는 현재 snapshot hash/revision으로 갱신하고 삭제된 source는 store/search에서 제거한다.
- non-text annotation은 indexing하지 않는다.
- coordinator와 PDF index 호출은 명시적 composition 주입 방식이다. 외부 전송 동의 없는 자동 production wiring은 추가하지 않았다.

## 7. Search / Diagnostics

- query embedding은 turn-local로 생성하고 persistence하지 않는다.
- `documentId + frozen pageId + granularity` 범위에서만 검색한다.
- cosine similarity는 dimension mismatch와 zero vector를 명시적으로 거부한다.
- score descending, `sourceObjectId` ascending tie-break로 deterministic Top-K를 반환한다.
- final threshold/weight와 Resolver semantic evidence 결합은 Phase C 책임이다.
- index/cache hit/cache miss/generated/batch/index latency와 search latency/candidate count를 bounded diagnostics에 기록할 수 있다.
- vector와 source text는 diagnostics에 기록하지 않는다.

## 8. Phase C Resolver

- `TargetStrategyRouter`가 relative/text_span/semantic_unit/object/subrange를 exhaustive dispatch한다.
- Relative는 frozen focus/history/recent authority를 유지하고 embedding을 사용하지 않는다.
- TextSpan은 Phase A Canonical Text Stream을 우선하고 embedding을 사용하지 않는다.
- SemanticUnit sentence/paragraph는 frozen page embedding Top-K를 semantic evidence로 사용한다.
- SemanticUnit line은 embedding granularity가 없어 lexical/fuzzy/structure만 사용한다.
- Object TEXT는 실제 Canvas annotation source ID의 `canvas_text` embedding을 사용할 수 있다.
- Subrange는 parent를 먼저 resolve한 뒤 현재 selector model limitation으로 unsupported를 반환한다.
- query kind별 weight/min score/margin은 `target-resolution-policy.ts` 한 곳에서 관리한다.
- cosine은 scoring evidence에서 `[0, 1]`로 clamp하며 negative similarity는 0이다.
- source ID가 Frozen Catalog에 없으면 stale result로 버리고 target으로 승격하지 않는다.
- query embedding/search 실패 또는 index 부재 시 기존 deterministic evidence로 degrade한다.
- planning pipeline만 async resolver를 await하며 기존 동기 `resolve()`와 Disambiguator contract는 유지한다.

Privacy:

- 기본 production composition은 embedding provider/search를 자동 생성하지 않는다.
- 명시적으로 embedding-enabled resolver를 주입한 경우에만 query text가 server provider boundary로 전달된다.
- vector/query/source text는 Direct Command trace에 기록하지 않는다.

Diagnostics:

```text
targetStrategy / evidenceUsed
embeddingUsed / embeddingCandidateCount
topSemanticScore / topSemanticMargin
queryEmbeddingMs / embeddingSearchMs
embeddingErrorCode
```

## 9. Phase D Typed Speech Normalization

- `SpeechGroundingEvidence`가 raw final transcript를 그대로 보존하고 term/number/math/context evidence를 별도 제공한다.
- `DirectCommandContextBuilder`가 Frozen Page catalog 생성 후 normalizer를 한 번 호출하고 같은 evidence 참조를 resolver input에 전달한다.
- evidence contract는 optional이며 normalizer 실패/legacy context에서는 빈 객체를 합성하지 않고 기존 deterministic grounding으로 degrade한다.
- Document Lexicon은 Frozen Page의 PDF word/line/sentence/paragraph와 Canvas TEXT candidate만 사용하며 최대 256개다.
- lexicon은 semantic/scene catalog에서 deterministic하게 재생성하므로 별도 IndexedDB persistence를 추가하지 않았다.
- 한국어식 영어 음차는 lightweight consonant/romanized edit heuristic으로 실제 lexicon 후보만 최대 3개 제공한다.
- `NumberHypothesis`는 integer/decimal/percent/sequence/power를 typed result로 제공하고 `이 삼`은 복수 ambiguous hypothesis로 유지한다.
- Editor의 현재 Math model은 `latex + optional mathJson`이며 typed AST가 없으므로 새 AST를 만들지 않는다.
- Math normalization은 x/y/z, 수, 기본 연산자, 제곱, 등호, 괄호만 normalized text/token으로 제공한다.
- optional ASR alternatives 입력 contract를 제공한다. 현재 Web Speech runtime은 top-1 transcript만 turn record에 보존한다.
- Web Speech의 experimental phrase bias 지원은 기존 bounded 30-term adapter를 유지하며, Phase D context terms는 focus 우선 Frozen Page 목록이다.
- normalization diagnostics는 사용 여부, hypothesis 수, math 상태, lexicon/context 크기와 latency만 보존하고 원문/lexicon 전체를 trace에 dump하지 않는다.
- typed evidence만으로 target 또는 Editor mutation을 실행하지 않으며 Stage C scoring은 변경하지 않았다.

## 10. Phase E Grounded Recovery

- 기존 `AMBIGUOUS`는 Stage 3 `DirectTargetDisambiguatorProvider` 경로를 유지한다.
- `semantic_unit`, `text_span`, `object`의 `NO_MATCH`/`LOW_CONFIDENCE`만 recovery 가능하다.
- relative focus/history 실패, unsupported subrange, target-kind unsupported, stale/Guard 실패는 recovery하지 않는다.
- 한 planning turn에서 recovery provider는 최대 한 번 호출하며 재계획/재시도 loop가 없다.
- `GroundedTargetRecoveryProvider`는 LLM/HTTP/fake 구현을 가지며 same-origin endpoint는 `/api/voice/direct-command/recover`다.
- browser production composition은 사용자 동의를 전제로 기존 same-origin `HttpGroundedTargetRecoveryProvider`를 기본 주입하며 recoverable `NOT_FOUND`에서만 `/api/voice/direct-command/recover`를 최대 한 번 호출한다.
- 서버 `OPENAI_API_KEY` 미설정, evidence 부재, network/config 실패는 기존 deterministic terminal result로 degrade한다.

Semantic/Object:

- Frozen Page의 동일 semantic unit 또는 동일 object type 후보만 사용한다.
- low-confidence embedding/ranking 후보, lexical ranking, focus, reading-order diversity를 union해 sentence 최대 24개, object 최대 16개로 제한한다.
- model에는 `C*`/`O*` label과 bounded text만 노출하며 선택 후 Frozen catalog candidate로 다시 매핑한다.
- Canvas semantic object recovery는 현재 실제 TEXT object만 지원한다.

TextSpan:

- Canonical Text Stream actual token과 Phase D document-grounded term hypothesis로 start `A*`, end `B*` 후보를 만든다.
- token ID/offset/readingOrder/coordinate는 model에 노출하지 않는다.
- duplicate anchor는 bounded neighboring text가 있는 별도 label로 유지한다.
- 선택 후 코드가 same page, actual token 존재, forward order를 검증하고 actual range와 line별 `Rect[]`를 materialize한다.
- 한쪽 실제 anchor 후보가 없으면 provider를 호출하지 않고 `NONE`으로 종료한다.

Safety/Lifecycle:

- strict output은 supplied label 또는 `NONE`만 허용하며 object ID, coordinate, operation 등 추가 field와 prose를 거부한다.
- recovery는 capability/operation/relation/payload/TargetQuery를 변경할 API가 없다.
- 복구 target은 기존 Stage 3 Guard에서 Frozen revision, target existence, permission/capability를 다시 검증한다.
- AbortSignal, timeout, invalid output, unavailable provider를 normalized recovery 상태로 처리한다.
- route idempotency/in-flight dedupe 바깥에 별도 loop나 history mutation을 추가하지 않았다.
- diagnostics는 recovery 사용 여부/kind/candidate count/result/error/latency와 initial/final resolution status만 기록한다.
- 전체 prompt, transcript, candidate dump, internal ID는 trace에 저장하지 않는다.

## 11. Validation

```text
Phase B targeted: 6 files / 20 tests PASS
Phase A + Phase B targeted: 9 files / 39 tests PASS
Web typecheck: PASS
Web targeted lint: PASS
Web package lint: PASS
Editor Core regression: 6 files / 47 tests PASS
Editor Core typecheck: PASS
Editor Core lint: PASS (existing config warnings only)
git diff --check: PASS
Phase D targeted: PASS
Stage 3.5 Phase A/B/C regression: PASS
Voice/Web regression: PASS
Editor Core regression: PASS
Web/Editor Core typecheck: PASS
targeted/package lint: PASS
Actual network smoke: SKIPPED
Phase C targeted: PASS
Stage 3.5 Phase A/B regression: PASS
Voice/Web regression: PASS
Editor Core regression: PASS
Web/Editor Core typecheck: PASS
targeted/package lint: PASS
git diff --check: PASS
Phase E targeted: 5 files / 37 tests PASS
Web regression: 89 files / 621 tests PASS
Editor Core regression: 6 files / 47 tests PASS
Web typecheck: PASS
Editor Core typecheck: PASS
Phase E targeted lint: PASS
Web package lint: PASS
Editor Core package lint: PASS
Phase F targeted: Editor Core 1 file / 5 tests PASS; Web 5 files / 14 tests PASS
Web regression: 93 files / 627 tests PASS
Editor Core regression: 7 files / 52 tests PASS
Web typecheck: PASS
Editor Core typecheck: PASS
Web package lint: PASS
Editor Core package lint: PASS (existing config warnings only)
git diff --check: PASS
```

현재 Web full regression에서는 기존 flaky로 기록된 `voice-debug-panel` 2건도
같은 full run에서 통과했다. 새 failure는 없다.

Environment:

- repository requires Node `>=22`
- current runtime: Node `20.19.4`, pnpm `10.9.0`
- engine mismatch warning은 기존 environment warning이다.
- Web full run의 기존 jsdom canvas `getContext` stderr가 출력됐다.
- Editor Core lint의 기존 React detect/pages-directory warning이 출력됐다.

## 12. Current Limitations

- embedding resolver integration은 sentence/paragraph/Canvas TEXT로 제한된다.
- PDF/Canvas 자동 외부 전송 production wiring은 없다. explicit index composition에서만 provider를 호출한다.
- English phonetic은 bounded deterministic hypothesis이며 hard recovery/확정은 하지 않는다.
- Semantic/Object recovery threshold의 final product tuning과 actual external LLM smoke는 수행하지 않았다.
- spaced number sequence는 ambiguity를 유지하며 문맥 판정은 Phase E 이후 책임이다.
- Math normalization은 기본 expression text/token 범위이며 typed Math AST/subrange는 없다.
- 별도 Memo type이 없어 `memo` granularity record는 생성하지 않는다.
- server vector DB/full-document default search는 없다.
- ASR N-best production 연결, 완전한 phoneme model, refresh 후 Voice short-term history persistence는 없다.
- Table/Math subrange와 Ink recognition은 unsupported다.
- spatial placement는 Stage 4 범위다.

## 13. Phase F / Final Architecture

- `UNDERLINE`/`HIGHLIGHT`는 optional ordered `rects`를 소유하고 기존 `bounds`는 union bounds로 유지한다.
- legacy schema v1의 `bounds`-only annotation은 변경 없이 hydrate된다. `rects`는 같은 schema의 additive field라 IndexedDB migration이 필요 없다.
- renderer는 각 실제 rect를 underline segment/highlight fill로 그리며 annotation object는 하나다.
- create/update/delete, snapshot/IndexedDB/hydration, operation log, Undo/Redo가 ordered rects를 보존한다.
- Voice compiler는 canonical `Rect[]`를 normalized `rects`로 변환하고 anchor나 geometry를 재추론하지 않는다.
- annotation rect count는 Editor Core의 중앙 상수 `256`으로 제한하고 finite positive normalized geometry만 commit한다.
- Direct Route의 frozen revision guard와 turn registry가 stale no-commit 및 concurrent/sequential exactly-once를 유지한다.

Final flow:

```text
Voice Turn
→ Planner / TargetQuery / Typed Speech Evidence
→ Target Strategy Router
→ Canonical Text / Embedding / Focus / History
→ RESOLVED or bounded Grounded Recovery
→ Guard
→ Capability Compiler
→ Multi-Rect aware Editor Runtime
→ one Operation / one Undo-Redo unit
```

## 14. Evaluation / Production Activation

Deterministic 12-category evaluation fixture 결과:

```text
Intent Accuracy: 1.0
Target Hit@1: 1.0
Anchor Start Accuracy: 1.0
Anchor End Accuracy: 1.0
Range Correctness: 1.0
Recovery Success: 2/3 (2 selected + 1 expected NONE)
Recovery NONE Precision: 1.0
False Commit Rate: 0
Embedding Cache Hit: 1.0 (instrumented semantic fixtures)
Recovery Rate: 0.25
Undo Integrity: 1.0
Synthetic latency p50/p95: 60ms / 120ms
```

위 수치는 deterministic harness 검증값이며 external model 품질/실 latency baseline이 아니다.
`plannerMs`, `queryEmbeddingMs`, `embeddingSearchMs`, `resolverMs`, `recoveryMs`,
`validationMs`, `compileMs`, `commitMs`, `directRouteMs`, `voiceEndToCommitMs`는
기존 bounded diagnostics에서 측정 가능하다.

Production activation:

- deterministic grounding과 multi-rect execution은 default production path에서 활성이다.
- embedding indexing/query는 외부 payload 전송 동의 및 explicit provider injection 시에만 활성이다.
- grounded recovery는 사용자 동의에 따라 browser production composition에서 활성이며 recoverable `NOT_FOUND`일 때만 bounded transcript/query/candidate context를 same-origin 서버 경계로 전송한다.
- 서버 provider가 unavailable하면 기존 deterministic grounding으로 degrade하며 빈 evidence를 만들지 않는다.
- actual external LLM smoke는 현재 환경에 `OPENAI_API_KEY`가 없어 `SKIPPED`다.

Production diagnostics:

- development 환경은 기존 `DirectCommandTraceStore`를 구독해 command kind, initial resolution reason, initial/final resolution, recovery result, Guard/execution status, error code와 latency만 `console.debug`로 노출한다.
- raw transcript, candidate text, prompt/response, internal ID, coordinate, embedding vector는 console trace에 포함하지 않는다.

## 15. Stage 4 Handoff

```text
Stage 3.5 COMPLETE
Next: Stage 4 — Structured Scene / VLM / Deterministic Spatial Placement
```

`DEFER_SPATIAL` 경계를 유지한다. Stage 4는 Structured Scene, Render Snapshot,
Focus Crop, Occupancy, Free-space Candidates, Multimodal Planner, bounded Placement
Candidate와 Deterministic Placement를 담당한다. Stage 4 구현은 시작하지 않았다.

## Speech Understanding / Grounding Hardening

Status: COMPLETE

Current production flow is Raw STT -> optional bounded Refiner -> Planner -> target-aware local retrieval -> deterministic Resolver -> optional Grounded Recovery -> Guard/Compiler/Editor. Clear commands skip Refiner and resolved targets skip Recovery. The local Frozen Page term universe is not truncated before ranking; only LLM Recovery candidates are bounded.

Production activation: browser composition includes same-origin HTTP Refiner and Recovery providers. Refiner payload is the bounded utterance plus language/allowed commands only. Recovery payload remains bounded candidates. Missing server AI configuration degrades to raw speech and deterministic grounding without blocking editing.

Evaluation separates Candidate Recall@K from candidate selection. Added fixtures cover command pollution, TextSpan boundary normalization, terms beyond the former 256-entry limit, multilingual phonetic recall, absent-term safety, and exact fast paths.

Known limitations remain ASR N-best production availability, persistent GroundingMemory, Math/Table subranges, ink recognition, and Stage 4 spatial placement.

## TextSpan Grounding Architecture Hardening

Status: COMPLETE

Current flow:

```text
Canonical exact fast path
-> target-slot normalization
-> hybrid seed retrieval over the full Frozen Page term universe
-> bounded multi-token phrase expansion and alignment
-> actual anchor occurrences
-> valid span-pair construction/ranking
-> deterministic confidence gate
-> optional supplied-pair-only Recovery (P* | NONE)
-> Canonical range / Rect[]
-> existing Guard / Compiler / multi-rect Editor runtime
```

Implementation state:

- Multi-token anchors use actual contiguous Canonical tokens; no persisted page-wide n-gram index.
- Pair ranking combines anchor confidence, sentence/paragraph structure, distance, focus and
  materializability. Distance is not a hard maximum.
- `TermHypothesis` remains non-authoritative evidence and cannot become normalized exact authority.
- TextSpan Recovery receives bounded valid pairs, not independent start/end lists.
- Diagnostics expose chunk/candidate counts, multi-token usage, pair count, top score/margin,
  deterministic selection and pair Recovery result without candidate text.
- Evaluation separates Anchor Candidate Recall@K, Anchor Phrase Accuracy, Span Pair Recall@K,
  Span Pair Selection Accuracy, Final Target Hit@1 and False Commit Rate.

Validation:

- TextSpan/Recovery/production targeted: 32 passed.
- Canonical/resolver/speech/pipeline/multi-rect regression: 93 passed.
- Web full: 99 files, 663 tests passed.
- Editor Core full: 7 files, 52 tests passed.
- Web and Editor Core strict typecheck passed.

Remaining limitations are unchanged: production ASR N-best/acoustic retrieval, persistent
GroundingMemory, Math/Table Subrange and Stage 4 Spatial Placement are not implemented.

## TextSpan Pair Selection Hardening

Status: COMPLETE

- Anchor alignment now preserves query/matched chunk counts, actual aligned occurrence, phrase
  coverage, phonetic/lexical evidence, unmatched boundary tokens and boundary precision.
- Same-occurrence expansion variants are canonicalized query-relatively; separate occurrences remain
  separate targets.
- Span pairs inherit both anchor evidence, remove invalid/duplicate/dominated variants, and use the
  centralized TextSpan score/margin confidence gate. Distance remains evidence, not a range limit.
- Clear full-coverage/clean-boundary pairs resolve deterministically. Ambiguous pairs alone reach the
  existing one-call supplied-`P*`/`NONE` Recovery provider with bounded interpretable evidence.
- Diagnostics and evaluation distinguish boundary accuracy, pre/post-pruning counts, deterministic
  resolution and LLM Recovery use without logging candidate text.
