# Stage 3.5 — Robust Multigranular Grounding: STATUS

## 1. 현재 상태

```text
Stage: 3.5 — Robust Multigranular Grounding
Phase A: COMPLETE
Phase B: COMPLETE
Phase C: COMPLETE
Phase D: COMPLETE
Current Milestone: Phase E — Grounded LLM Recovery
```

`FrozenTargetResolver` facade는 기존 동기 API를 유지하고 production planning용
async strategy router를 추가했다. Typed speech evidence는 turn context에서 한 번
생성되며 Phase E/F 구현은 시작하지 않았다.

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

## 10. Validation

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
```

Web full regression에서는 기존 `voice-debug-panel` happy-path 1건이 fake speech
session timing으로 실패했다. 동일 파일 단독 재실행은 1 file / 2 tests PASS였고,
Phase A/Phase B/Direct Command 테스트는 full run에서도 통과했다. 새 embedding
regression으로 분류하지 않는다.

Environment:

- repository requires Node `>=22`
- current runtime: Node `20.19.4`, pnpm `10.9.0`
- engine mismatch warning은 기존 environment warning이다.
- Web full run의 기존 jsdom canvas `getContext` stderr가 출력됐다.
- Editor Core lint의 기존 React detect/pages-directory warning이 출력됐다.

## 11. Current Limitations

- embedding resolver integration은 sentence/paragraph/Canvas TEXT로 제한된다.
- PDF/Canvas 자동 외부 전송 production wiring은 없다. explicit index composition에서만 provider를 호출한다.
- English phonetic은 bounded deterministic hypothesis이며 hard recovery/확정은 하지 않는다.
- Grounded LLM recovery는 없다.
- spaced number sequence는 ambiguity를 유지하며 문맥 판정은 Phase E 이후 책임이다.
- Math normalization은 기본 expression text/token 범위이며 typed Math AST/subrange는 없다.
- multi-rect geometry는 resolve되지만 실제 annotation mutation은 single rect limitation을 유지한다.
- 별도 Memo type이 없어 `memo` granularity record는 생성하지 않는다.
- server vector DB/full-document default search는 없다.

## 12. Next Milestone

```text
Phase E — Grounded LLM Recovery
```

- AMBIGUOUS / recoverable NOT_FOUND
- target-kind-specific candidate-only recovery
- TextSpan start/end anchor recovery
- NONE policy / recovery max 1
