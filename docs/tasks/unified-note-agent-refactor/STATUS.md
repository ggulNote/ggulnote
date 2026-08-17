# Unified Note Agent Refactor — STATUS

## Current State

```text
Phase: 5 — tldraw Object Catalog / One Decision
Status: IMPLEMENTED LOCALLY / EXTERNAL CATALOG HANDOFF AND DEFAULT CUTOVER GATED
Current Milestone: approve bounded catalog egress, connect it to the live provider, then collect live parity
Date: 2026-08-18
```

The explicit `NEXT_PUBLIC_NOTE_AGENT_ROUTE=production` path now uses tldraw
as the mutable user-created canvas source of truth, projects PDF semantic
objects plus TLStore shapes into one world, constructs request-local O-handles,
prepares every step without mutation, and commits one tldraw history
transaction. The no-flag legacy default is unchanged.

## Branch / Base

```text
requested source: refactor/note-agent-parts-actions
requested base: fecabbab59016d3a2afe87836990e307a7ef26ff
original worktree actual HEAD: 677b9e8a6e26c074923dbe544c3fb1cb29d57e6d
Phase 5 branch: refactor/tldraw-object-catalog-one-decision
Phase 5 branch base: fecabbab59016d3a2afe87836990e307a7ef26ff
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

## Object Catalog / Provider Gate

Every request gets a new O-handle map. All current-page user-created objects
are included with bounded summaries, normalized bounds, capabilities, and
selection/focus/recent flags. PDF paragraphs and semantic
figure/table/equation/image regions are compacted; raw PDF words are excluded.
Persistent IDs, full PDF/page text, and screenshot bytes are excluded.

Responses strict JSON Schema is generated from enabled registry actions and is
connected as `text.format=json_schema`. The external provider prompt was
shortened and document/page IDs were removed. The catalog is assembled and
sent only to the same-origin route today. Adding bounded object summaries to
the external OpenAI request is pending explicit approval after disclosure; live
handle selection is therefore not claimed.

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

Same-origin HTTP forwards validated numeric telemetry only. Trace data excludes
full object/document text, screenshot bytes, persistent IDs, and Authorization
headers.

## Verification

```text
Node: 22.23.2
Web full: 141 files / 982 tests PASS
Editor Core full: 7 files / 54 tests PASS
Web strict typecheck: PASS
Editor Core strict typecheck: PASS
Web lint: PASS
Editor Core lint: PASS (existing config warnings only)
git diff --check: PASS
```

Manual browser smoke with the production flag verified Blank-page tldraw
mount, actual text rendering, click selection, double-click editing,
contenteditable update, refresh/IndexedDB restoration, and zero page errors.
The shape was seeded through the actual tldraw Editor for UI smoke, not by
voice. Live OpenAI/network, microphone, PDF voice underline, and the complete
voice browser scenario were not run.

## Known Limitations / Next Milestone

1. Explicit approval is required before Object Catalog summaries enter the
   external OpenAI request.
2. Live model/network/microphone parity and operating latency are absent;
   production-default cutover remains gated.
3. Top-level `NEEDS_VISUAL` second pass is fail-closed; the connected
   one-pass path is existing Stage 4 placement ambiguity.
4. The canonical SceneObject model has no standalone sentence kind, so the new
   PDF catalog currently uses paragraphs and semantic regions.
5. Graph/table/equation/diagram and generic move/delete/style production
   mutations remain unavailable.

The next milestone is to obtain the bounded catalog egress approval, connect
that one provider message, run live strict-schema parity, and only then review
the default cutover.

## Commits

```text
d05b02c refactor(note-agent): add tldraw catalog decision runtime
test/docs: the commit containing Phase 5 verification and status
```
