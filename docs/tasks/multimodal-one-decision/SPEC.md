# Multimodal One Decision - SPEC

## Goal

Note Agent의 production 경로를 다음 구조로 단순화한다.

```text
Page Base Cache + Live Scene Context + Marked Screenshot + Voice Command
  -> ONE Multimodal Decision
  -> Typed Action[]
  -> Deterministic Local Engine
  -> Tldraw Transaction / Render
```

LLM/VLM은 의미, 의도, object reference, content kind, tool 선택과 필요한 final canvas placement를 담당한다.
로컬은 lookup, validation, normalized coordinate projection, geometry, math, PDF glyph lookup, render, transaction, undo만 담당한다.

## Milestones

### M1 - Page context foundation

- 현재 production 실행 경로와 타입 조사
- immutable `PageBaseSnapshot`과 `LiveSceneContext` 계약 추가
- page별 stable object handle cache 추가
- 최초 관찰 world를 base로 고정하고 이후 create/update/delete를 live로 분리
- PDF text-addressable object의 전체 text 유지
- model input을 `STATIC -> PAGE_BASE -> LIVE -> SCREENSHOT -> COMMAND` 순서로 구성
- pure cache/delta와 prompt ordering 단위 테스트

### M2 - Marked multimodal snapshot

- agent 전용 offscreen canvas에 page-normalized object bounds와 `[O*]` handle overlay
- screenshot request/encoded metadata/catalog handle 일치 검증
- 가능한 경우 structured world와 high-detail marked screenshot을 같은 Decision 호출에 첨부
- capture failure/stale/mismatch는 추가 model 호출 없이 structured-only로 저하

### M3 - Minimal action target and deterministic resolver

- `ActionTarget`의 object, object-local normalized region, fallback point 계약
- object -> object-region -> fallback-point 순서의 local resolver
- text/shape/math registered action 연결과 grounding trace

### M4 - One-call cutover and cleanup

- 기본 경로의 repair/disambiguation/preview LLM 재호출 제거
- local natural-language heuristic 우회/삭제
- production/debug trace와 end-to-end 회귀 검증

### M5 - Final placement and semantic math parameters

- production `READY.steps[]`에서 relation/destination 대신 page-normalized final placement 사용
- text/math create는 LLM placement를 local coordinate projection으로만 실행
- graph expression을 source of truth로 유지하고 descriptor/sampling/render는 math-core가 계산
- graph point와 tangent는 graph-domain coordinate를 받고 local math engine이 계산
- PDF text range는 canonical anchors를 유지하고 glyph geometry는 local에서 계산
- production relation candidate execution 경로 제거와 대표 명령 회귀 검증

## Non-goals

- 별도 object detector/OCR/RAG/vector DB/knowledge graph
- agent loop 또는 다중 agent pipeline
- `/editor` UI 대규모 변경
- 기존 InteractionClock, Worker 응답 방어, Raw Gaze Timeline 변경
