# Unified Note Agent Refactor — STATUS

## Current State

```text
Phase: 5 — tldraw Object Catalog / One Decision
Status: IMPLEMENTED / DEFAULT VOICE OWNER CUT OVER
Current Milestone: observe the default owner and complete microphone/PDF browser smoke
Date: 2026-08-18
```

The no-flag app voice path now uses the Phase 5 Note Agent as its only semantic
decision owner. It preserves the raw final transcript, projects PDF semantic
objects plus TLStore shapes into one world, sends the compact request-local
O-handle catalog through one strict Decision call, prepares every step without
mutation, and commits one tldraw history transaction. The legacy planner is
available only through the explicit `NEXT_PUBLIC_NOTE_AGENT_ROUTE=legacy`
rollback flag; Phase 5 failure does not fall back to it.

## Branch / Base

```text
requested source: refactor/note-agent-parts-actions
requested base: fecabbab59016d3a2afe87836990e307a7ef26ff
original worktree actual HEAD: 677b9e8a6e26c074923dbe544c3fb1cb29d57e6d
Phase 5 branch: refactor/tldraw-object-catalog-one-decision
Phase 5 branch base: fecabbab59016d3a2afe87836990e307a7ef26ff
default-cutover preflight HEAD: 8d363f4d7ba7b6bc836c2f30594e934e75d26afb
default-cutover worktree: tracked clean; only pre-existing next, pnpm untracked
default-cutover commit: 32932e5 refactor(voice): cut over to one note decision
preserved original files: tracked in-progress work, untracked next, pnpm
```

An isolated worktree was used because the original tracked tree was dirty and
its HEAD was one commit ahead of the expected base. No original change was
reset, restored, cleaned, stashed, edited, or committed.

## Current Production Flow

```text
CompletedVoiceTurn
→ NoteContextAssembler
→ PDF semantic world + read-only tldraw projection
→ UnifiedObjectWorld
→ Compact Object Catalog + fresh handle map
→ one NoteDecisionProvider call
→ Action.prepare validation / PDF span / geometry / operation compile
→ TldrawNoteAgentTransaction.commit once
→ tldraw History + semantic Operation Ledger
```

- `useOwnedBrowserDirectCommandComposition()` selects this flow when the route
  variable is absent, `production`, or unknown. `legacy` is the explicit
  rollback value and `shadow` remains an explicit no-commit comparison mode.
- There is no Fast Path. Next page, previous page, and undo each call the
  Decision Provider exactly once.
- LLM-selected handles are resolved but never replaced by exact/fuzzy/semantic
  target rules.
- Stage 3.5 is used only for range alignment inside the already selected PDF
  object on the new path.
- Normal placement uses zero visual calls. Existing Stage 4 bounded
  crop/VLM/preview/final guard remains limited to one visual call.
- First-decision `NEEDS_VISUAL` currently fails closed with commit zero; its
  generic second pass remains unconnected.

## tldraw / PDF / Persistence

- tldraw 5.2.5 owns user-created text/annotation mutable state, bounds,
  selection/focus, history, undo, and snapshots.
- Built-in text shapes are reused. One `note-annotation` custom shape owns all
  visual segments of one logical underline/highlight.
- PDF.js remains the PDF renderer, semantic hierarchy, character offset, and
  glyph geometry owner; PDF words are not TLShapes.
- The existing IndexedDB `pageSnapshots` record stores a versioned optional
  tldraw snapshot. Legacy records import into TLStore; no new database or dual
  mutable SceneObject state was added.

## Object Catalog / Provider

Every request gets a new O-handle map. All current-page user-created objects
are included with bounded summaries, normalized bounds, capabilities, and
selection/focus/recent flags. PDF paragraphs and semantic
figure/table/equation/image regions are compacted; raw PDF words are excluded.
Persistent IDs, full PDF/page text, and screenshot bytes are excluded.

Responses strict JSON Schema is generated from enabled registry actions and is
connected as `text.format=json_schema`. The external provider prompt was
shortened and document/page IDs were removed. After explicit user approval on
2026-08-18, the external request now includes the bounded `OBJECT_CATALOG`
message. It contains request-local handles, source/kind, normalized bounds,
capabilities, flags, and bounded summaries/parts only. Live handle selection is
verified for the representative Korean placement request.

On 2026-08-18, the Node 22 same-origin `/api/voice/note-decision` route loaded
`apps/web/.env.local` and made a real Responses API call for
`안녕하세요 밑에 가나다라라고 써 줘` with `O1 = 안녕하세요`. The strict result
was `READY`, `text.create`, `text=가나다라`, `anchor=O1`, `relation=BELOW`.
The call returned HTTP 200 with 2250.1 ms OpenAI TTFB, 42.0 ms body read,
0.52 ms JSON parse, 1183 input tokens, and 51 output tokens. This is one
representative sample, not an operating percentile.

## Atomicity / Undo

- All steps prepare before any mutation.
- One tldraw mark/run/squash transaction owns a successful logical turn.
- Child apply failure bails to the mark.
- Later prepare failure, invalid handle, stale revision, clarification, and
  unresolved visual state commit zero.
- One tldraw undo reverts the logical turn.
- Operation Ledger remains semantic history only, not a second canvas undo
  stack.

## Telemetry

```text
contextAssemblyMs, tldrawProjectionMs,
objectCatalogBuildMs, objectCatalogObjectCount, objectCatalogSerializedChars,
decisionTotalMs, openaiTtfbMs, openaiBodyReadMs, decisionJsonParseMs,
inputTokens, cachedInputTokens, outputTokens,
visualCallCount, prepareMs, commitMs
```

The bounded development trace additionally records `runtimeOwner`,
`decisionSchemaVersion`, request-local catalog handles, selected/reference
handle, action/relation, and explicit `legacyPlannerInvoked=false` and
`fuzzyObjectSelectorInvoked=false`. It does not retain transcript or object
text.

Same-origin HTTP forwards validated numeric telemetry only. Trace data excludes
full object/document text, screenshot bytes, persistent IDs, and Authorization
headers.

## Verification

```text
Node: 22.23.2
Targeted cutover: 7 files / 29 tests PASS
Web full: 141 files / 984 tests PASS
Editor Core full: 7 files / 54 tests PASS
Web strict typecheck: PASS
Editor Core strict typecheck: PASS
Web lint: PASS
Editor Core lint: PASS (existing config warnings only)
Web production build: PASS (Next 16.2.10; tldraw CSS resolved)
Live OpenAI strict Decision: PASS (HTTP 200, O1 / BELOW)
git diff --check: PASS
```

The earlier Phase 5 manual browser smoke with the production flag verified Blank-page tldraw
mount, actual text rendering, click selection, double-click editing,
contenteditable update, refresh/IndexedDB restoration, and zero page errors.
The shape was seeded through the actual tldraw Editor for UI smoke, not by
voice. During this cutover session the app loaded over HTTP 200 and the live
same-origin OpenAI route was exercised, but Windows Computer Use could not
connect to its native pipe and no Playwright/agent-browser binary was
installed. Microphone UI, PDF voice underline, and the complete browser voice
scenario therefore remain unrun.

## Known Limitations / Next Milestone

1. Live model/network parity has one representative passing sample, but
   microphone/browser parity, rollback observation, and operating p50/p90/p95
   remain absent.
2. Top-level `NEEDS_VISUAL` second pass is fail-closed; the connected
   one-pass path is existing Stage 4 placement ambiguity.
3. The canonical SceneObject model has no standalone sentence kind, so the new
   PDF catalog currently uses paragraphs and semantic regions.
4. Graph/table/equation/diagram and generic move/delete/style production
   mutations remain unavailable.

The next milestone is to observe the default owner in the real browser voice
flow, run PDF underline and duplicate-object smoke, and collect operating
latency before removing the explicit legacy rollback route.

## Commits

```text
d05b02c refactor(note-agent): add tldraw catalog decision runtime
02730b0 docs(note-agent): enforce and record phase 5 decision contract
8d363f4 feat(note-agent): send approved object catalog in one decision
32932e5 refactor(voice): cut over to one note decision
docs(note-agent): record default voice owner cutover
```
