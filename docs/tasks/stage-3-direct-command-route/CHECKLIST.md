# Stage 3 — Direct Command Route: CHECKLIST

## 사용법

- `[ ]` 미완료
- `[x]` 완료
- 완료 시 관련 commit / test 결과를 `STATUS.md`에 기록한다.
- Stage 3 작업 중 Stage 2 Voice Turn / Voice Lens를 대규모 리팩터링하지 않는다.
- 체크 순서는 구현 순서를 의미한다.

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
CompletedVoiceTurn → typed DirectPlannerResult 계약을 테스트할 수 있어야 한다.
```

---

# Phase B. Context Builder / Target Resolver / Eligibility Guard

- [ ] `DirectCommandContextBuilder` 구현
- [ ] Raw Final Transcript 그대로 전달
- [ ] Frozen Context 그대로 사용
- [ ] Frozen Focus SceneObject metadata 조회
- [ ] 전체 Scene / screenshot 미전달 확인
- [ ] last successful operation context 연결
- [ ] `FROZEN_FOCUS` resolver
- [ ] `LAST_TARGET` resolver
- [ ] `CURRENT_PAGE` resolver
- [ ] `LAST_OPERATION` resolver
- [ ] Scene Revision validation
- [ ] target compatibility validation
- [ ] editable / annotatable guard
- [ ] spatial-required request의 no-commit guard
- [ ] stale scene 테스트
- [ ] missing focus 테스트
- [ ] PDF read-only text edit 차단 테스트
- [ ] editable canvas text 허용 테스트
- [ ] Phase B 문서 상태 갱신

완료 조건:

```text
Planner가 잘못된 실행 계획을 반환해도
코드 레벨 validation을 통과하지 못하면 Editor에 닿지 않아야 한다.
```

---

# Phase C. Single Text Planner Integration

- [ ] 프로젝트의 기존 AI server/provider 구조 재사용
- [ ] 브라우저 secret 노출 없음 확인
- [ ] 한 번의 Planner 호출로 refine + intent + relation + command 생성
- [ ] Planner prompt에서 document text를 untrusted data로 분리
- [ ] allowed capability / operation 명시
- [ ] coordinate 생성 금지
- [ ] spatial request는 `DEFER_SPATIAL`
- [ ] self-correction 처리
- [ ] "방금 거 취소" → `history.undo`
- [ ] timeout / abort / network error normalize
- [ ] malformed model output reject
- [ ] model/provider를 domain 코드에 하드코딩하지 않음
- [ ] provider unit test
- [ ] mocked integration test
- [ ] Phase C 문서 상태 갱신

완료 조건:

```text
실제 Planner adapter가 strict result만 반환하며,
Refiner API를 별도로 호출하지 않아야 한다.
```

---

# Phase D. Capability Compile / Editor Runtime Integration

- [ ] `annotation.underline` existing editor action으로 compile
- [ ] `annotation.highlight` existing editor action으로 compile
- [ ] highlight default color는 existing editor setting 사용
- [ ] `navigation.next_page` 연결
- [ ] `navigation.previous_page` 연결
- [ ] `history.undo` existing history에 연결
- [ ] `text.replace_content` editable text에 연결
- [ ] 별도 undo stack 생성하지 않음
- [ ] 별도 editor runtime 생성하지 않음
- [ ] compile 실패 시 no commit
- [ ] commit 실패 시 error normalize
- [ ] operation에 source turnId 추적 가능
- [ ] underline integration test
- [ ] highlight integration test
- [ ] navigation integration test
- [ ] undo integration test
- [ ] text replace integration test
- [ ] Phase D 문서 상태 갱신

완료 조건:

```text
Fake/Mock Planner 결과가 실제 기존 Editor Runtime을 통해
한 번의 deterministic mutation으로 commit되어야 한다.
```

---

# Phase E. Relation / History / Idempotency

- [ ] `NEW` 처리
- [ ] `REVISE_LAST` 처리
- [ ] replacement plan은 full plan으로 생성
- [ ] replace는 가능한 한 atomic transaction으로 처리
- [ ] `CONTINUE`의 `LAST_TARGET` 재사용
- [ ] `CANCEL`은 no mutation
- [ ] duplicate turnId commit 방지
- [ ] duplicate in-flight planner call 방지
- [ ] last successful Direct Operation record 관리
- [ ] failed/deferred turn이 last successful operation을 덮어쓰지 않음
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
- [ ] validationMs 계산
- [ ] compileMs 계산
- [ ] commitMs 계산
- [ ] directRouteMs 계산
- [ ] voiceEndToCommitMs 계산 가능
- [ ] debug payload에서 turnId / planId / operationId 추적
- [ ] raw document 전체를 기본 로그에 남기지 않음
- [ ] spatial request → `DEFER_SPATIAL` integration test
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
→ Planner 1회
→ strict DirectCommandPlan
→ target/revision/capability validation
→ deterministic compile
→ existing Editor commit
```

최소 E2E 시나리오:

- [ ] "여기 밑줄 쳐줘"
- [ ] "노란색으로 하이라이트해줘"
- [ ] "밑줄 아니 밑줄 말고 노란색 하이라이트"
- [ ] "노란색 말고 파란색으로"
- [ ] "다음 페이지"
- [ ] "이전 페이지"
- [ ] "방금 거 취소해"
- [ ] editable text replace
- [ ] PDF source text replace 차단
- [ ] spatial command `DEFER_SPATIAL`
- [ ] duplicate turn exactly-once commit
- [ ] stale scene no commit
