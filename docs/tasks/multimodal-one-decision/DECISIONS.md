# Multimodal One Decision - Decisions

## D1. Existing production route is retained

- `VoiceTurnController -> DirectCommandVoiceTurnBridge -> NoteAgentProductionRoute -> NoteRuntime -> registered tool -> TldrawNoteAgentTransaction` 경계를 재사용한다.
- 기존 strict `READY.steps[]`와 registry/tool별 schema를 유지한다.

## D2. Base is captured once per document/page in the route-owned assembler

- `NoteContextAssembler` 수명 동안 document/page별 최초 catalog를 immutable base로 고정한다.
- 새 전역 store나 React state를 만들지 않는다.
- 이후 current catalog와 base fingerprint를 비교하여 live created/updated/deleted context를 만든다.

## D3. One stable handle namespace

- 기존 `O1`, `O2`, ... handle을 유지한다.
- page cache가 scene object ID와 handle의 매핑을 보존한다.
- base, live, current compatibility catalog, 향후 marked screenshot이 같은 handle을 사용한다.

## D4. Compatibility catalog is temporarily retained

- M1에서는 기존 runtime/provider validation용 `objectCatalog`를 유지한다.
- model prompt의 structured world는 `pageBase`와 `liveScene`만 사용한다.
- 후속 cutover에서 중복 계약 제거 여부를 결정한다.

## D5. Prompt order is explicit

- `instructions`는 static system policy다.
- input message 순서는 `STATIC_CONTEXT`, `PAGE_BASE`, `LIVE_SCENE`, optional screenshot, `VOICE_COMMAND`다.
- turn ID, transcript, scene revision 같은 dynamic 값은 page base 뒤에 둔다.

## D6. Marked screenshot is an agent-only offscreen composition

- 실제 사용자 canvas DOM에 임시 label을 추가하지 않는다.
- 기존 PDF canvas, legacy overlay, tldraw export를 새 offscreen canvas에 합성한 뒤 page-normalized catalog bounds에 `[O*]` label을 그린다.
- marker는 별도 namespace를 만들지 않고 catalog의 기존 stable handle을 그대로 사용한다.

## D7. Visual evidence is attached only after identity validation

- production route는 screenshot source가 있으면 catalog 크기와 무관하게 한 번 capture를 시도한다.
- request marker와 encoded screenshot metadata의 ID, 순서, bounds가 정확히 일치해야 같은 Decision에 첨부한다.
- unavailable, stale scene, marker mismatch는 structured-only Decision으로 저하하며 repair/verification LLM 호출을 만들지 않는다.
- marked screenshot은 전체 현재 페이지 visual context를 포함하므로 production multimodal 전송에 대한 사용자 승인을 받은 범위에서 사용한다.

## D8. ActionTarget stays minimal and normalized

- 기존 stable `O*` handle을 `target.object`에서 그대로 사용한다.
- `target.region`은 object-local normalized `[0, 1]` bounds이며 canvas pixel을 Decision에 저장하지 않는다.
- `target.fallbackPoint`는 normalized point와 `OBJECT_LOCAL` 또는 `PAGE` coordinate space를 명시한다.
- Responses strict schema에서는 `object`, `part`, `region`, `fallbackPoint`를 항상 명시하고 사용하지 않는 값은 `null`로 보낸다.
- 기존 fixture와 내부 caller의 단계적 호환을 위해 parser는 optional field 생략을 계속 허용하지만, 잘못된 범위와 모순된 조합은 즉시 거부한다.

## D9. TargetResolver only looks up and transforms

- local resolver는 handle 존재 확인, current render bounds 조회, normalized-to-canvas transform만 수행한다.
- grounding 우선순위는 `OBJECT -> OBJECT_REGION -> FALLBACK_POINT -> structural failure`다.
- 명시적 ActionTarget이 있으면 기존 selection/focus/recent destination보다 우선한다.
- fallback 사용과 실패 처리에는 추가 model 호출이나 자연어 의미 추측을 사용하지 않는다.

## D10. Visual circle is an existing registered math action

- 이미지 내부 visual region 표시는 기존 `math.shape.create_circle` action을 registered math tool에 연결한다.
- LLM은 object와 region만 결정하며 circle center/radius와 local geometry는 math-core가 deterministic하게 생성한다.
- tangent는 LLM이 graph-domain `at.x`를 결정하고 math-core가 함수값, 미분값, 접선식을 계산한다.

## D11. Production has a hard one-call boundary

- `LlmNoteDecisionProvider.decide`는 turn당 `transport.generate`를 한 번만 호출한다.
- parse/schema/PDF canonical range validation 실패는 `PLANNER_INVALID_OUTPUT`으로 종료하며 repair model 호출을 만들지 않는다.
- Note Agent disambiguation 계약과 prompt는 제거한다. 기존 `/api/voice/note-decision/disambiguate` compatibility endpoint는 model을 호출하지 않고 `410 ONE_DECISION_REQUIRED`를 반환한다.
- production `NoteRuntime`은 strict `READY.steps[]`만 실행한다. legacy parser 호환용 `CALL`/`BATCH`는 production에서 `LEGACY_DECISION_FORMAT`으로 거부한다.

## D12. Local placement and text grounding are mechanical only

- Note Agent create placement는 LLM이 선택한 page-normalized final geometry를 pixel 좌표로 투영하고 page bounds로 구조적으로 clamp만 한다.
- production `READY.steps[]`에는 destination/relation/candidate가 없으며 local slot 선택이나 spatial 의미 재해석을 수행하지 않는다.
- PDF text target은 canonical stream의 exact anchor/range만 조회하고 검증한다. transcript 기반 fuzzy span recovery는 Note Agent 경로에서 사용하지 않는다.
- explicit legacy direct-command route의 기존 provider/heuristic은 호환을 위해 유지하지만 기본 Note Agent production route에는 연결하지 않는다.

## D13. Production never requests a second visual pass

- production response schema에서 `NEEDS_VISUAL`, `candidateHandles`, `cropRegion`을 제거한다.
- 최초 Decision에 첨부된 marked screenshot이 유일한 visual pass다.
- visual evidence가 없거나 충분하지 않으면 같은 응답에서 `NEEDS_CLARIFICATION`과 `VISUAL_UNRESOLVED`를 반환한다.
- parser-only shadow fixture 호환 타입은 유지하지만 production runtime은 `NEEDS_VISUAL` decision을 실행하지 않는다.

## D14. Each domain keeps its semantic source of truth

- text/formula/graph/shape create는 필요한 경우에만 page-normalized `placement`를 갖는다.
- graph는 `args.expression`이 source of truth이며 math-core가 지원 descriptor와 sampling/render data를 deterministic하게 만든다.
- graph point는 `args.point.{x,y}`, tangent는 `args.at.x`를 graph-domain 좌표로 받는다. canvas line/point geometry는 Decision 계약에 없다.
- PDF underline/highlight는 exact canonical `startText`/`endText`를 source of truth로 유지하고 glyph rect는 local PDF/text engine이 계산한다.
- 사용되지 않던 `ExistingPlacementEngine` candidate facade와 Note Agent용 `DecisionDestination` 계약은 제거했다. `Destination -> SpatialPlacementQuery` 변환은 구형 `EditorNoteAgentTransaction` 호환 경로에만 남긴다.
