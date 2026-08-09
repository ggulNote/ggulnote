# Stage 3 — Direct Command Route: CHECKLIST

## 사용법

- `[ ]` 미완료
- `[x]` 완료
- 완료 시 관련 commit / test 결과를 `STATUS.md`에 기록한다.
- Stage 3 작업 중 Stage 2 Voice Turn / Voice Lens를 대규모 리팩터링하지 않는다.
- 체크 순서는 구현 순서를 의미한다.
- Phase A는 완료 상태를 유지한다. Phase B 시작 시 최종 Grounding Architecture에 맞춘 **contract alignment**는 허용한다.

---

# Phase 0. Preflight / Existing Architecture 확인

- [x] 현재 branch / HEAD / `git status` 확인
- [x] `AGENTS.md` 재독
- [x] Stage 2 `DECISIONS.md` 재독
- [x] Stage 2 `SPEC.md` 재독
- [x] Stage 2 `CHECKLIST.md` 완료 상태 확인
- [x] Stage 2 `STATUS.md`에서 완료 commit / known issue 확인
- [x] `CompletedVoiceTurn` 실제 타입과 생성 위치 확인
- [x] Frozen Context 타입 / Scene Revision 타입 확인
- [x] Scene Core의 Object lookup API 확인
- [x] 기존 Annotation action / compiler / executor 확인
- [x] 기존 Page navigation API 확인
- [x] 기존 Operation Log / Undo API 확인
- [x] 기존 editable text mutation API 확인
- [x] 기존 AI provider / server boundary가 있는지 검색
- [x] reset / clean / stash 없이 기존 미커밋 변경 보존
- [x] Stage 3 branch가 없으면 현재 Stage 2 완료 HEAD에서 `feat/stage-3-direct-command-route` 생성

완료 조건:

```text
새 코드를 쓰기 전에 Stage 3가 재사용해야 할 실제 타입/API 목록이 정리되어 있어야 한다.
```

---

# Phase A. Direct Command Domain / Provider Contracts

- [x] `CommandRelation` 정의
- [x] `DirectTargetRef` 정의
- [x] Direct command discriminated union 정의
- [x] Planner result union 정의
- [x] Route result / error code 정의
- [x] 기존 Scene / Voice / Editor ID 타입 재사용
- [x] `DirectCommandPlannerProvider` 계약 정의
- [x] `FakeDirectCommandPlannerProvider` 구현
- [x] strict runtime schema validation 구현
- [x] unknown capability reject 테스트
- [x] unknown operation reject 테스트
- [x] coordinate field 등 금지 field reject 테스트
- [x] `DEFER_SPATIAL` schema 테스트
- [x] Phase A 문서 상태 갱신

완료 조건:

```text
LLM/network 없이 Fake Provider로
typed DirectPlannerResult 계약을 테스트할 수 있어야 한다.
```

Phase B contract alignment:

```text
FROZEN_FOCUS / LAST_TARGET
→ RelativeTargetQuery로 일반화

CURRENT_PAGE / LAST_OPERATION
→ navigation/history control target으로 유지

Phase A의 provider/fake/strict parser 기반은 그대로 재사용
```

---

# Phase B. Command Context / Frozen Target Grounding / Eligibility Guard

## B0. Architecture Contract Alignment

- [ ] DECISIONS / SPEC의 TargetQuery 구조 확인
- [ ] 기존 `DirectTargetRef`를 최소 변경으로 TargetQuery 구조에 정렬
- [ ] `FROZEN_FOCUS` → `RelativeTargetQuery(focused)` 의미 정렬
- [ ] `LAST_TARGET` → `RelativeTargetQuery(last_target)` 의미 정렬
- [ ] `CURRENT_PAGE` / `LAST_OPERATION` control target 유지 여부 결정 및 문서화
- [ ] Phase A strict parser를 새 TargetQuery union에 맞게 확장
- [ ] arbitrary objectId reject 유지
- [ ] coordinate x/y reject 유지
- [ ] Phase A provider/fake provider 재사용

## B1. Existing Grounding Sources 조사

- [ ] Frozen revision의 SceneSnapshot을 얻는 실제 경로 확인
- [ ] historical snapshot 미지원 시 stale 처리 정책 구현
- [ ] PDF Scene object/source 타입 확인
- [ ] Semantic paragraph/sentence/line 표현 확인
- [ ] text offset/range/bounds 표현 확인
- [ ] Canvas / Annotation object 타입 확인
- [ ] editable/source 판별 경로 확인
- [ ] operation timestamp / created object / target 추적 가능 여부 확인
- [ ] 없는 semantic type을 새로 invent하지 않음

## B2. TargetQuery / ResolvedTarget Domain

- [ ] `TextSpanTargetQuery` 구현
- [ ] `SemanticUnitTargetQuery` 구현
- [ ] `ObjectTargetQuery` 구현
- [ ] `RelativeTargetQuery` 구현
- [ ] `SubrangeTargetQuery` 확장 계약 구현
- [ ] `ResolvedTextSpan` 구현
- [ ] `ResolvedObject` 구현
- [ ] `ResolvedMathSpan` / `ResolvedObjectSubrange`는 실제 모델 지원 수준에 맞춰 contract 또는 unsupported path 정의
- [ ] TargetResolutionResult: `RESOLVED`
- [ ] TargetResolutionResult: `AMBIGUOUS`
- [ ] TargetResolutionResult: `NOT_FOUND`

## B3. PageTargetCatalog

- [ ] `PageTargetCatalog` 구현
- [ ] Frozen Page의 PDF/document candidate adapter
- [ ] Frozen Page의 Ggulnote editable candidate adapter
- [ ] `source: pdf | ggulnote` 표현
- [ ] `editable` 표현
- [ ] `annotatable` 표현 가능한 경우 연결
- [ ] text/type/bounds metadata 연결
- [ ] recent operation metadata 연결 가능한 경우 연결
- [ ] 다른 page candidate 제외
- [ ] internal candidateId를 Planner authority로 사용하지 않음

## B4. DirectCommandContextBuilder

- [ ] `DirectCommandContextBuilder` 구현
- [ ] Raw Final Transcript 그대로 보존
- [ ] Frozen Context 그대로 authority로 사용
- [ ] Frozen page/revision snapshot 사용
- [ ] 최신 page로 drift하지 않음
- [ ] 최신 focus로 drift하지 않음
- [ ] PageTargetCatalog 포함
- [ ] recent operations 포함
- [ ] Planner용 bounded context 분리
- [ ] Planner context에 internal objectId/candidateId 미노출
- [ ] screenshot/image 미생성
- [ ] frozen snapshot unavailable 시 `STALE_SCENE`

## B5. Candidate Evidence / Ranking

- [ ] `CandidateEvidence` 정의
- [ ] `typeMatch`
- [ ] `lexicalMatch`
- [ ] `fuzzyMatch`
- [ ] `temporalMatch`
- [ ] `structuralMatch`
- [ ] `focusMatch`
- [ ] `semanticMatch` optional/unavailable 정책
- [ ] `mathMatch` optional/unavailable 정책
- [ ] Unicode/text normalization
- [ ] 한국어 spacing 차이 완화
- [ ] 경미한 STT mismatch용 deterministic fuzzy similarity
- [ ] 외부 embedding service 추가하지 않음
- [ ] threshold/margin을 단일 policy/config로 관리

## B6. FrozenTargetResolver

- [ ] Relative focused target resolve
- [ ] Relative last target resolve
- [ ] Relative recent target ranking
- [ ] TextSpan target resolve
- [ ] SemanticUnit target resolve — 현재 semantic layer 지원 범위
- [ ] Object target resolve — 현재 editable object 지원 범위
- [ ] Subrange target은 실제 지원 수준에 맞게 resolve/unsupported
- [ ] `RESOLVED` high confidence 처리
- [ ] `AMBIGUOUS` 후보 반환
- [ ] `NOT_FOUND` 처리
- [ ] `AMBIGUOUS`에서 임의 top1 선택 금지
- [ ] 가짜 offset/token/stroke mapping 생성 금지

## B7. Direct Eligibility / Guard

- [ ] Scene Revision validation
- [ ] target 존재 validation
- [ ] capability allowlist
- [ ] operation allowlist
- [ ] payload schema validation
- [ ] target type compatibility
- [ ] PDF source read-only guard
- [ ] PDF text + underline 허용
- [ ] PDF text + highlight 허용
- [ ] PDF source + `text.replace_content` 차단
- [ ] Ggulnote editable text + `text.replace_content` 허용
- [ ] spatial-required typed plan no-commit guard
- [ ] 실제 Editor mutation은 아직 하지 않음

## B8. Tests / Docs

- [ ] RelativeTargetQuery schema 테스트
- [ ] TextSpanTargetQuery schema 테스트
- [ ] SemanticUnitTargetQuery schema 테스트
- [ ] ObjectTargetQuery schema 테스트
- [ ] SubrangeTargetQuery schema 테스트
- [ ] arbitrary objectId reject regression
- [ ] coordinate x/y reject regression
- [ ] Frozen page/revision context test
- [ ] PageTargetCatalog PDF + editable source test
- [ ] focus resolution test
- [ ] text span resolution test
- [ ] fuzzy ranking test
- [ ] recent/last target test
- [ ] ambiguous no-auto-select test
- [ ] not found test
- [ ] stale scene test
- [ ] PDF read-only guard test
- [ ] editable text guard test
- [ ] Phase B 문서 상태 갱신

완료 조건:

```text
TargetQuery
→ Frozen PageTargetCatalog
→ deterministic candidate ranking
→ ResolvedTarget | AMBIGUOUS | NOT_FOUND
→ permission/revision guard
```

까지 LLM/network와 Editor mutation 없이 테스트할 수 있어야 한다.

---

# Phase C. Single Text Planner + Conditional Text Disambiguation

- [ ] Stage 3 전용 server-side AI boundary 설계
- [ ] 브라우저 secret 노출 없음 확인
- [ ] 최초 Planner 한 번으로 refine + intent + relation + command + TargetQuery 생성
- [ ] Planner prompt에서 document text를 untrusted data로 분리
- [ ] allowed capability / operation 명시
- [ ] arbitrary objectId 생성 금지
- [ ] coordinate 생성 금지
- [ ] spatial request는 `DEFER_SPATIAL`
- [ ] self-correction 처리
- [ ] "방금 거 취소" → `history.undo`
- [ ] timeout / abort / network error normalize
- [ ] malformed model output reject
- [ ] provider/model을 domain 코드에 하드코딩하지 않음
- [ ] Resolver `AMBIGUOUS` 시에만 candidate-only Text Disambiguator 연결
- [ ] Disambiguator는 `C1..Cn | NONE`만 반환
- [ ] candidate 밖 objectId 생성 금지
- [ ] VLM 사용하지 않음
- [ ] provider unit test
- [ ] mocked integration test
- [ ] Phase C 문서 상태 갱신

완료 조건:

```text
최초 Planner는 1회 호출로 refine + intent + TargetQuery를 만들고,
AMBIGUOUS인 경우에만 제한된 후보 선택용 Text LLM을 조건부 호출한다.
```

---

# Phase D. Capability Compile / Editor Runtime Integration

- [ ] `annotation.underline` existing editor action으로 compile
- [ ] `annotation.highlight` existing editor action으로 compile
- [ ] PDF 원문 변경 없이 Editable Layer annotation 생성
- [ ] highlight default color는 existing editor setting 사용
- [ ] `navigation.next_page` 연결
- [ ] `navigation.previous_page` 연결
- [ ] `history.undo` existing history에 연결
- [ ] `text.replace_content` Ggulnote editable text에 연결
- [ ] PDF source text replace compile 차단
- [ ] 별도 undo stack 생성하지 않음
- [ ] 별도 editor runtime 생성하지 않음
- [ ] compile 실패 시 no commit
- [ ] commit 실패 시 error normalize
- [ ] operation에 source turnId 추적 가능
- [ ] underline integration test
- [ ] text span underline integration test
- [ ] highlight integration test
- [ ] navigation integration test
- [ ] undo integration test
- [ ] text replace integration test
- [ ] Phase D 문서 상태 갱신

완료 조건:

```text
ResolvedTarget + CommandPlan이 실제 기존 Editor Runtime을 통해
deterministic mutation으로 commit되어야 한다.
```

---

# Phase E. Relation / History / Idempotency

- [ ] `NEW` 처리
- [ ] `REVISE_LAST` 처리
- [ ] replacement plan은 full plan으로 생성
- [ ] `RelativeTargetQuery(last_target)` grounding
- [ ] replace는 가능한 한 atomic transaction으로 처리
- [ ] `CONTINUE`의 last target 재사용
- [ ] `CANCEL`은 no mutation
- [ ] duplicate turnId commit 방지
- [ ] duplicate in-flight planner call 방지
- [ ] last successful Direct Operation record 관리
- [ ] failed/deferred/ambiguous turn이 last successful operation을 덮어쓰지 않음
- [ ] revise last integration test
- [ ] continue target integration test
- [ ] cancel no-op test
- [ ] duplicate turn integration test
- [ ] Phase E 문서 상태 갱신

완료 조건:

```text
연속 발화에서도 이전 작업 맥락을 안전하게 재사용하고,
동일 turn이 중복 commit되지 않아야 한다.
```

---

# Phase F. Diagnostics / Regression / Stage Completion

- [ ] route lifecycle timestamp 추가
- [ ] plannerMs 계산
- [ ] resolverMs 계산
- [ ] validationMs 계산
- [ ] compileMs 계산
- [ ] commitMs 계산
- [ ] directRouteMs 계산
- [ ] voiceEndToCommitMs 계산 가능
- [ ] debug payload에서 turnId / planId / operationId 추적
- [ ] targetQueryKind / resolvedTargetKind / resolverConfidence 추적
- [ ] raw document 전체를 기본 로그에 남기지 않음
- [ ] spatial request → `DEFER_SPATIAL` integration test
- [ ] ambiguous target no-commit/disambiguation test
- [ ] stale scene no-commit integration test
- [ ] invalid planner output no-commit integration test
- [ ] 기존 Stage 1/2 테스트 regression 실행
- [ ] lint / typecheck / test 실행
- [ ] `git diff --check`
- [ ] `STATUS.md` 최종 갱신
- [ ] 완료 commit 기록
- [ ] known issue / deferred item 기록

Stage 3 최종 완료 조건:

```text
CompletedVoiceTurn
→ 최초 Planner 1회
→ strict DirectCommandPlan + TargetQuery
→ FrozenTargetResolver
→ ResolvedTarget
→ target/revision/capability/permission validation
→ deterministic compile
→ existing Editor commit
```

최소 E2E 시나리오:

- [ ] "여기 밑줄 쳐줘"
- [ ] "세종대왕의부터 업적까지 밑줄 쳐줘"
- [ ] "노란색으로 하이라이트해줘"
- [ ] "AI의 문제점을 설명하는 문장 하이라이트"
- [ ] "밑줄 아니 밑줄 말고 노란색 하이라이트"
- [ ] "노란색 말고 파란색으로"
- [ ] "다음 페이지"
- [ ] "이전 페이지"
- [ ] "방금 거 취소해"
- [ ] editable text replace
- [ ] PDF source text replace 차단
- [ ] ambiguous target 추측 실행 없음
- [ ] spatial command `DEFER_SPATIAL`
- [ ] duplicate turn exactly-once commit
- [ ] stale scene no commit
