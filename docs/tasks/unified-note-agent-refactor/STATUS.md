# Unified Note Agent Refactor — STATUS

## Current State

```text
Phase: 2 — One Decision + Tool Runtime Shadow Mode
Status: COMPLETE
Current Milestone: COMPLETE / READY FOR PHASE 3 REVIEW
Date: 2026-08-13
```

## Branch / Base

```text
branch: refactor/unified-note-agent
start HEAD: 46eed4ee8184ac6724d69228e8db3d007d862a05
base: feat/stage-4.5-accuracy-improvements @ fc61be5
Phase 2 implementation: 7f1ed19f1fd9ce40b7b6e2c987959ab5e79ec438
working tree at start: untracked next, pnpm
preserved unrelated files: next, pnpm
```

## Contracts

- `EntitySelector`는 scope/kind/source/content/attributes/temporal/ordinal/context/spatial을
  optional constraint로 유지한다.
- spatial relation 11종, page region 10종, Entity/Page Region/Focus/Selection reference,
  Page/Relative `Destination`을 strict parser로 검증한다.
- nested selector는 최대 깊이 2다. unknown/malformed/prototype-bearing object와
  object/candidate/range/part ID, coordinate, bounds, rect, offset authority를 거부한다.
- decision은 `CALL`, atomic `BATCH`(최대 4), `NEEDS_INPUT`, `UNSUPPORTED`, `NO_OP`만
  허용한다.

## Runtime / Existing Adapter Reuse

- `NoteToolRegistry`는 namespaced ID, kind, compact input/output schema, availability,
  execution과 duplicate protection을 제공한다.
- adapter: `text.create`, `text.replace`, `annotation.apply`, `navigation.next_page`,
  `navigation.previous_page`, `history.undo`.
- `object.move/delete/style`과 Graph/Math/Table은 기존 stable direct compiler가 없어
  production registry에 노출하지 않았다.
- `ExistingWorldResolver`는 Phase 1 World/ObjectIndex와 기존 `FrozenTargetResolver`를
  감싼다. explicit target miss는 focus/selection/history로 대체하지 않는다.
- `ExistingPlacementEngine`은 기존 Stage 4 candidate engine/deterministic gate/profile/
  measurement를 재사용하고 user-created object의 `renderBounds`/rects도 anchor로 쓴다.
- Phase 2 `NoteRuntime`에는 editor commit port가 없다. strict input/output schema,
  capability, scene revision을 검사하며 항상 `commitAttempted: false`다.

## Decision Provider / Shadow Wiring

- 기존 `DirectTextModelTransport`, server-only OpenAI transport, JSON/error boundary를
  재사용한다. 새 API key/client 경로는 없다.
- same-origin endpoint는 `/api/voice/note-decision`이며 AbortSignal, strict input/output,
  available-tool authority를 검증한다.
- decision input은 transcript, frozen document/page/revision/mode, selection/focus/last
  operation summary, compact tool schema만 포함한다. 전체 scene/PDF/history/screenshot은 없다.
- `NEXT_PUBLIC_NOTE_AGENT_SHADOW_MODE=1`일 때만 shadow path를 함께 실행한다. 기본값은
  기존 production route 단독이다.
- 기존 Direct/Spatial route가 유일한 commit owner다. shadow 실패는 명시적으로 trace되고
  기존 route 결과를 막지 않는다.
- bounded trace는 decision/tool/resolver/placement/old route status, LLM/tool call count,
  decision/runtime/total latency, commit attempted 여부를 기록한다.

## Shadow / Parity Result

- deterministic decision fixture 12종으로 기본/page-region/relative 생성, user-created
  anchor, graph/delete 계약, recent underline, PDF range, selection/no-selection,
  explicit not-found, PDF immutable, unavailable graph를 검증했다.
- PDF fuzzy grounding은 기존 Stage 3.5 resolver를, placement는 기존 Stage 4 engine을
  실제 adapter 뒤에서 회귀 검증했다.
- duplicate explicit target은 compact candidate 4개로 제한하고 missing explicit target은
  focus/selection이 있어도 `NOT_FOUND`다. stale revision은 commit 전에 거부한다.
- executable parity test에서 old route 1회, decision LLM 1회, tool 1회, persistent shadow
  mutation 0회를 확인했다.
- 실제 model/network latency는 credential 없는 deterministic test에서 측정하지 않았다.
  운영 shadow trace의 latency 수집 경계만 완료했다.

## Verification

```text
Phase 1+2 Note Agent targeted: 9 files / 53 tests PASS
Web full (Stage 2/3/3.5/4 포함): 131 files / 936 tests PASS
Editor Core full: 7 files / 53 tests PASS
Web typecheck: PASS
Editor Core typecheck: PASS
Web package lint: PASS
Editor Core package lint: PASS (existing config warnings only)
git diff --check: PASS
```

Environment:

- repository requirement: Node `>=22`
- validation runtime: Node `20.19.4`, pnpm `10.9.0`
- engine mismatch와 Editor Core React/pages-directory lint warning은 기존 환경 warning이다.
- Web validation stderr와 jsdom canvas stderr는 기존 의도된/known output이며 테스트는
  PASS다.

## Known Limitations

- real model parity/latency sample과 trace persistence는 아직 없다.
- `text.create`는 기존 Stage 4 profile/measurement/snapshot이 준비된 composition에서만
  shadow available이다.
- `BETWEEN` search는 두 reference 계약이 없어 `UNSUPPORTED`이며 `MARGIN`은 placement
  destination만 지원한다.
- Graph/Math/Table과 generic object move/delete/style은 production tool로 노출하지 않았다.
- 기존 Direct Planner, normalizer, fixed union, Direct/Spatial route는 유지했다.

## Commits

```text
phase 1 implementation: 4ab6d3a feat(scene): add unified object world foundation
phase 1 status: 46eed4e docs(note-agent): record phase 1 status
phase 2 implementation + tests: 7f1ed19 feat(note-agent): add shadow decision runtime
phase 2 status: docs(note-agent): record phase 2 status
```

## Next Milestone

```text
Phase 3 — Production Cutover / Cleanup / Extensibility Proof
```

Phase 3는 real shadow/parity와 latency 결과를 검토한 뒤 별도 세션에서 시작한다.
