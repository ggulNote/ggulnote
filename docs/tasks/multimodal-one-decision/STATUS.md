# Multimodal One Decision - Status

## Branch

`feat/multimodal-one-decision`

## Current State

- `feat/flexible-note-interaction`의 로컬 HEAD와 미커밋 변경을 보존해 작업 브랜치 생성.
- 원격에는 `feat/flexible-note-interaction` 동명 branch가 없어 pull 생략.
- production Voice/Note Agent/world/catalog/prompt/screenshot/tldraw transaction 실행 경로 조사 완료.
- 현재 `/canvas` route는 없고 `/editor`가 `DocumentWorkspace` production workspace를 소유함을 확인.
- `PageBaseSnapshot`과 `LiveSceneContext` strict input 계약 구현.
- `NoteContextAssembler` 수명의 page cache가 최초 catalog를 immutable base로 동결.
- scene object ID와 `O*` handle 매핑을 page별로 유지해 이후 object 추가에도 base handle이 안정적임.
- 이후 current world를 base와 비교해 created/updated/deleted live context 생성.
- PDF text-addressable object의 전체 text와 page text를 base에 유지.
- model input 순서를 `STATIC_CONTEXT -> PAGE_BASE -> LIVE_SCENE -> optional screenshot -> VOICE_COMMAND`로 변경.
- 기존 merged `objectCatalog`는 local validation/handle lookup 호환용으로만 유지하고 prompt에는 중복 전송하지 않음.
- `CanvasSpatialScreenshotSource`가 실제 canvas와 분리된 offscreen target에 `[O*]` label과 bounds를 합성함.
- catalog의 동일 handle/bounds 목록을 screenshot capture에 전달하고 반환 metadata까지 일치할 때만 visual context를 첨부함.
- screenshot source가 있는 모든 production Decision에서 marked capture를 한 번 시도하며, unavailable/stale/mismatch이면 추가 LLM 호출 없이 structured-only로 저하함.
- model input은 structured `PAGE_BASE`/`LIVE_SCENE`과 marked high-detail image를 같은 Decision 호출에 전달함.
- development trace에 marked screenshot handle/count와 attach/failure 상태를 노출함.
- `ActionTarget`을 stable object handle, optional object-local normalized region, explicit normalized fallback point로 확장함.
- `ActionTargetResolver`가 current object bounds를 lookup하고 region/point를 canvas 좌표로 deterministic하게 변환함.
- grounding은 `OBJECT`, `OBJECT_REGION`, `FALLBACK_POINT` 세 mode만 사용하며 모두 실패하면 structural failure로 종료함.
- 명시적 ActionTarget을 registered text/shape/math tool에 전달하고 legacy selection/focus보다 우선하도록 연결함.
- 이미지 내부 region용 기존 `math.shape.create_circle` action을 연결하고 circle geometry는 math-core에서 계산함.
- runtime/production development trace에 grounding mode, resolved handle/bounds/point, final local operation을 노출함.
- production Decision provider는 turn당 `transport.generate`를 정확히 한 번만 호출하며 invalid PDF text range도 local structural failure로 종료함.
- Note Agent disambiguation provider/prompt를 제거하고 기존 HTTP compatibility endpoint는 model 호출 없이 `410 ONE_DECISION_REQUIRED`를 반환함.
- production runtime은 strict `READY.steps[]`만 실행하며 legacy `CALL`/`BATCH` decision을 거부함.
- Note Agent placement에서 별도 placement VLM/ghost preview 호출과 candidate second pass를 제거하고 deterministic geometry만 사용함.
- PDF text target은 canonical exact range만 검증하며 local fuzzy semantic repair를 수행하지 않음.
- production response schema에서 `NEEDS_VISUAL`과 crop/candidate 필드를 제거해 nullable schema와 status별 parser 계약의 불일치를 해소함.
- visual evidence가 부족하면 추가 screenshot/model pass 없이 `NEEDS_CLARIFICATION(VISUAL_UNRESOLVED)`로 종료함.

## Completed Milestone

`M4 (One-call cleanup)` 완료.

## Current Milestone

없음. 계획된 M1-M4를 완료했다.

## Known Problems

- 전체 web test의 기존 `editor-shell.test.tsx` 4건은 jsdom `image.decode is not a function`으로 실패한다.
- 저장소 요구 Node는 `>=22`이나 현재 검증 환경은 `v20.19.4`다.
- 현재 shell과 `apps/web/.env.local`에 `OPENAI_API_KEY`/`DIRECT_COMMAND_MODEL`이 없어 실제 OpenAI live eval은 실행하지 못했다.
- explicit legacy direct-command route용 provider와 heuristic 코드는 호환 경로에 남아 있지만 기본 Note Agent production 경로에서는 호출되지 않는다.
- parser-only shadow fixture용 `NEEDS_VISUAL` 타입은 남아 있지만 production schema에는 노출되지 않는다.

## Next Milestone

없음. 후속 작업은 별도 결정 전까지 시작하지 않는다.
