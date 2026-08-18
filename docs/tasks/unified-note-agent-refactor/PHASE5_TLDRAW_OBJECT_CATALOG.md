# Phase 5 — tldraw Object Catalog / One Decision

## Scope and branch

```text
requested source branch: refactor/note-agent-parts-actions
requested base HEAD: fecabbab59016d3a2afe87836990e307a7ef26ff
new branch: refactor/tldraw-object-catalog-one-decision
implementation commit: d05b02c refactor(note-agent): add tldraw catalog decision runtime
documentation commit: the commit containing this document
approved catalog handoff: the final commit containing the external payload connection
default voice owner cutover: 32932e5 refactor(voice): cut over to one note decision
```

The original worktree was on the requested source branch at
`677b9e8a6e26c074923dbe544c3fb1cb29d57e6d`, one commit after the requested
base, and had unrelated tracked work plus pre-existing untracked `next` and
`pnpm`. No reset, restore, clean, stash, or mutation was applied there. This
branch was created in an isolated worktree directly from the requested
`fecabbab` base.

## Actual production path

```text
CompletedVoiceTurn
→ NoteContextAssembler
→ PDF semantic SceneObjects + read-only tldraw TLStore projection
→ UnifiedObjectWorld
→ request-local Compact Object Catalog (O1, O2, ...)
→ one NoteDecisionProvider call
→ READY action/handle/part/destination steps
→ NoteAction.prepare()
→ deterministic validation / span alignment / geometry / operation compile
→ TldrawNoteAgentTransaction
→ one TldrawEditorAdapter history transaction
→ semantic Operation Ledger
```

This is now the default app voice path. An absent route value and explicit
`production` both select the Phase 5 owner. `shadow` remains the explicit
no-commit comparison mode, and `legacy` is the explicit rollback-only
selection. Production failure is fail-closed; it does not fall back silently
to a legacy semantic route.

There is no Fast Path. Actionable next-page, previous-page, and undo turns call
the same Decision Provider exactly once. Cancelled turns, empty final
transcripts, unavailable provider initialization, and disposed runtime remain
lifecycle exclusions.

## Default voice owner cutover

The root cause was composition ownership, not the Phase 5 Decision runtime.
`VoiceTurnController` and `DirectCommandVoiceTurnBridge` preserved the raw
transcript, but `noteAgentRoutingOptions()` returned no Note Agent options when
`NEXT_PUBLIC_NOTE_AGENT_ROUTE` was absent. The browser composition then chose
`direct.route`, so the real UI ran the legacy planner and could return
`EXECUTABLE`, rewritten `normalizedIntent`, and `placementQuery` before Phase 5
was ever invoked.

Before:

```text
CompletedVoiceTurn
→ browser direct composition (no flag)
→ DirectCommandRoute
→ legacy planner / target resolver / Stage 4 semantic placement
→ EXECUTABLE + placementQuery
```

After:

```text
CompletedVoiceTurn
→ browser direct composition (default)
→ NoteAgentProductionRoute
→ rawFinalTranscript + UnifiedObjectWorld + Object Catalog
→ one strict NoteDecision
→ deterministic prepare / atomic tldraw commit
```

The legacy planner and resolver implementations remain available for explicit
rollback and their own regression fixtures, but are not invoked by the default
voice owner. Tests inject spies at both boundaries and assert zero calls.

## tldraw and PDF boundary

- tldraw 5.2.5 owns mutable user-created canvas state, shape bounds,
  selection/focus, text editing, history, undo, and snapshot/load in the
  production path.
- Built-in tldraw text shapes are reused. ggulNote metadata is stored in shape
  `meta`; there is no metadata-only custom text shape.
- `note-annotation` is one logical custom shape. Multiple underline/highlight
  rectangles remain segments inside that shape's props.
- `TldrawEditorAdapter` is the only boundary importing tldraw types for agent
  execution. Agent domain contracts contain no `Editor`, `TLStore`, or
  `TLShapeId`.
- PDF.js remains the PDF renderer and semantic/text/glyph owner. PDF words and
  lines are not converted into TLShapes. The PDF base and tldraw overlay share
  canonical page coordinates.
- Graph, table, equation, and diagram custom shapes remain extension points;
  unavailable production mutations were not invented.

The existing IndexedDB `pageSnapshots` record was versioned with optional
tldraw snapshot fields. Legacy annotation snapshots import once into TLStore;
after load, the tldraw store is the mutable source of truth. No second database
or duplicate mutable SceneObject store was introduced.

## Unified world and Object Catalog

Every request constructs a new `NoteObjectHandleMap`. The LLM-facing catalog
contains only request-local handles, source/kind, normalized bounds,
capabilities, and selected/focused/recent flags. Text-addressable PDF paragraphs
and Canvas text use one untruncated `text` field. PDF paragraph text reuses the
semantic sentence reconstruction, including whitespace normalization and
line-end dehyphenation. Non-text objects keep compact summary/parts. Persistent
tldraw shape IDs, database IDs, PDF internal IDs, document-wide text, raw word
or glyph entries, and screenshot bytes are excluded.

All current-page user-created objects are included before optional detail
compression. They are not capped by the old six-candidate policy. The bounded
visual candidate set remains at most six. Current PDF projection includes
paragraphs and semantic figure/table/equation/image regions; raw word objects
are excluded. The current canonical SceneObject model has no sentence kind, so
standalone PDF sentence catalog entries remain a recorded limitation rather
than a parallel duplicate model.

When required context exceeds the hard token budget, assembly fails explicitly
with commit zero. Objects are not silently dropped, and this phase adds no RAG,
vector database, embedding retrieval, or knowledge graph.

## One Decision contract

The new strict decision variants are `READY`, `NEEDS_VISUAL`,
`NEEDS_CLARIFICATION`, and `NOT_ALLOWED`. READY contains up to four action
steps with nullable target, destination, and part fields. A request-local
discriminated step union is generated from the enabled
`NoteToolRegistry` action definitions; every object uses
`additionalProperties: false` and strict optional values are nullable.

The same-origin/server-only Responses transport now supports
`text.format.type=json_schema`, `strict=true`, and the registry-generated
schema. The system contract is intentionally short and assigns semantic
intent, typo/recent/object/part/destination selection to the model while
assigning existence, capability, stale revision, geometry, math, and execution
to deterministic code.

The user explicitly requested current-page full semantic text on 2026-08-18.
The external OpenAI request includes one `OBJECT_CATALOG` message containing
request-local handles, source/kind, normalized bounds, capabilities,
selected/focused/recent flags, full canonical text for PDF paragraphs and
Canvas text, and compact summary/parts for non-text objects. It does not add
persistent object IDs, documentId/pageId, document-wide text, raw word/glyph
entries, or screenshot bytes. `AVAILABLE_ACTIONS` contains only action ID and
semantic description; the strict response JSON Schema is the single argument
schema source of truth. Fake/local Decision Providers still cover the complete
handle runtime. A real Node 22 same-origin call on 2026-08-18 sent
`안녕하세요 밑에 가나다라라고 써 줘` with catalog object `O1 = 안녕하세요`
and returned strict `READY`, `text.create`, `text=가나다라`, `anchor=O1`,
and `relation=BELOW`.

## Decision responsibility versus deterministic runtime

The model decides intent, action, object handle, part, recent/deictic
reference, typo reference, semantic relation, multi-step composition, and
whether visual evidence is necessary. Deterministic code only validates and
executes the selected handle. It never substitutes a similar object.

`Action.prepare()` resolves the chosen handle, validates object/part
existence and capability, checks scene revision, aligns a PDF text range inside
the already selected PDF object, computes placement/glyph/math geometry, and
compiles tldraw operations. It has no persistent mutation authority.

User-created object commands do not call the Stage 3.5 primary object search,
fuzzy selector, or `anchorQuery` resolver. Stage 3.5 remains only for bounded
text-range alignment inside an LLM-selected PDF object. Existing resolver and
index code remains for legacy comparison, world projection, and future
measured retrieval work.

## Placement and visual behavior

The model emits semantic relations (`ABOVE`, `BELOW`, `LEFT_OF`,
`RIGHT_OF`, `INSIDE`, `BETWEEN`, or `CANVAS_REGION`). Stage 4 computes
coordinates, collision/boundary candidates, preview validation, and the final
stale guard. Normal READY decisions make zero visual calls. Existing Stage 4
visual ambiguity uses one bounded crop/VLM call at most and accepts only a
current alias or `NONE`.

The first-decision `NEEDS_VISUAL` schema is parsed and fails closed with
`NEEDS_INPUT visual`, commit zero. A generic second pass from that top-level
status is not yet connected; the implemented one-pass visual path is the
existing Stage 4 placement ambiguity path. This limitation is not reported as
complete.

## Atomicity and undo owner

All steps prepare before commit. `TldrawEditorAdapter` uses the installed
tldraw history API: one history stopping point, one `editor.run`, squash on
success, and bail on child failure. The guarantees covered by tests are:

- prepare side effect zero;
- multiple prepared canvas operations commit as one transaction;
- later prepare failure, invalid handle, stale scene, or clarification commits
  zero;
- child apply failure rolls the full transaction back;
- one tldraw undo reverts the logical turn;
- a committed batch cannot be committed twice by the runtime owner.

tldraw History is the canvas undo source of truth. The Operation Ledger stores
semantic action history, turn ID, and created/updated object references for
recent context; it is not a second canvas undo stack.

## Telemetry and data retention

The production trace connects:

```text
contextAssemblyMs, tldrawProjectionMs,
objectCatalogBuildMs, objectCatalogObjectCount, objectCatalogSerializedChars,
decisionTotalMs, openaiTtfbMs, openaiBodyReadMs, decisionJsonParseMs,
inputTokens, cachedInputTokens, outputTokens,
visualCallCount, prepareMs, commitMs
```

The default production trace also records the bounded diagnostic fields
`runtimeOwner=note-agent-v2`, `decisionSchemaVersion`, catalog handles,
selected/reference handle, decision action/relation,
`legacyPlannerInvoked=false`, and `fuzzyObjectSelectorInvoked=false`.
Transcript, object text, and persistent identifiers are not stored in this
trace.

Same-origin HTTP forwards only validated numeric telemetry. Trace payloads do
not retain full document/object text, screenshot bytes, persistent object IDs,
or Authorization headers.

## Verification

Final validation runtime: Node 22.23.2, pnpm 10.9.0.

```text
Targeted cutover: 7 files / 29 tests PASS
Web full: 141 files / 984 tests PASS
Editor Core full: 7 files / 54 tests PASS
Web strict typecheck: PASS
Editor Core strict typecheck: PASS
Web lint: PASS
Editor Core lint: PASS (existing config warnings only)
Web production build: PASS (Next 16.2.10)
Live OpenAI strict Decision: PASS (HTTP 200, O1 / BELOW)
git diff --check: PASS
```

The later full-text consolidation passed Editor Core targeted 1 file / 24
tests and Web targeted 7 files / 54 tests on Node 22.23.2. Web and Editor Core
strict typecheck and changed-file lint also passed. Full suites, build, and a
live OpenAI call were not rerun after this consolidation.

The Web suite covers projection/catalog privacy and freshness, all
user-created objects, raw PDF word exclusion, invalid handles, no primary
resolver call, selected-PDF-object-only range alignment, no-fast-path provider
counts, sequential typo/recent placement, duplicate text clarification,
bounded visual behavior, transaction rollback/undo, persistence, and
PDF/Blank shared runtime.

## Manual browser smoke

The earlier Phase 5 UI smoke, run before this default-cutover session, used the
explicit production flag without a live model request:

- home/editor and Blank page loaded;
- tldraw mounted with no Next runtime error or page error;
- an actual tldraw Editor text shape was seeded for UI smoke (not through
  voice), rendered, clicked/selected, and entered text editing on double click;
- contenteditable text changed from `안녕하세요` to `안녕하세요 수정`;
- refresh restored the same shape and rich text from the existing IndexedDB
  snapshot;
- console contained only tldraw Korean-locale missing-message warnings.

This cutover session exercised the real same-origin OpenAI route and loaded the
app over HTTP 200. Windows Computer Use could not connect to its native pipe,
and neither Playwright nor agent-browser was installed, so microphone capture,
voice-driven PDF underline, and the full 12-step browser voice scenario were
not executed. The sequential voice flow, PDF range, undo, and duplicate-object
safety remain covered by fake Decision Provider integration tests.

## Remaining limitations and cutover gate

1. One representative live model/network request passed; microphone/browser
   parity, operating percentiles, and rollback observation remain unverified.
2. Top-level `NEEDS_VISUAL` second-pass orchestration remains fail-closed;
   only the existing Stage 4 placement visual pass is connected.
3. Standalone PDF sentence entries are not in the canonical SceneObject
   projection; paragraph/semantic-region objects are present and raw words are
   excluded.
4. Graph/table/equation/diagram mutations and generic move/delete/style remain
   unavailable.
5. Browser smoke did not execute voice-created text, PDF underline, or a live
   model decision.
6. Headings, captions, and list items remain represented by the canonical
   paragraph kind; distinct catalog kinds were not invented.
7. An abnormally large current page fails closed at the existing context
   budget; lossless semantic splitting remains an extension point.
