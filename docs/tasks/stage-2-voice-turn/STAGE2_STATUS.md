# 꿀노트 Agent 2단계 Status

> 이 파일은 Codex가 구현 과정에서 지속적으로 갱신한다.
> 완료하지 않은 항목을 완료했다고 기록하지 않는다.

## 1. 기본 정보

| 항목 | 값 |
|---|---|
| 단계 | 2단계: Browser Web Speech 기반 Voice Turn과 Voice Lens |
| 상태 | IN PROGRESS |
| 기준일 | 2026-08-06 |
| 작업 브랜치 | `feat/stage-2-voice-turn` |
| 기준 브랜치 | `feat/unified-scene-core` |
| 기준 Commit | `354c76e` (`feat(scene): add unified PDF and canvas scene core`) |
| Phase A Commit | `a0a02a0` (`feat(voice): add speech recognition provider contract`) |
| Phase B Commit | `81bddba` (`feat(voice): add Web Speech recognition provider`) |
| Phase C Commit | `0129654` (`feat(voice): add voice turn controller and context freeze`) |
| Phase D Commit | `ee08797` (`feat(voice): add voice trigger and focus-anchored voice lens`) |
| 최종 Commit | 없음 |
| 담당 | Codex |
| MVP Browser | Desktop Chrome |
| 기본 언어 | ko-KR |

## Current Milestone

```text
Phase D — DONE: React Hook, Voice Trigger, Voice Lens, Frozen Focus screen positioning
```

Phase A/B/C 커밋과 clean worktree를 확인하고 `c1aa3de`를 기준으로 Phase D를 완료했다. Phase C의 `VoiceTurnController`, State Machine, Context Freeze, TranscriptAccumulator를 변경하지 않고 React 구독/표현/Editor composition만 추가했다. Phase E Debug UI와 Stage 3 기능은 포함하지 않았다.

Phase C 완료 확인:

```text
0129654 feat(voice): add voice turn controller and context freeze
c1aa3de docs(voice): record stage 2 phase C status
```

Phase D 조사 결과:

- 기존 Voice Trigger/Lens UI는 없다.
- `/editor`는 `DocumentWorkspace`가 `EditorEngine`을 안정적으로 소유하고 `useSyncExternalStore`로 구독한다.
- 페이지 DOM 경계는 `DocumentStage.stageRef`, 현재 CSS 크기는 `renderedWidth`/`renderedHeight`, canonical 크기는 `state.page.width`/`height`다.
- Zoom/페이지 Resize는 기존 `ResizeObserver`와 Stage DOM `getBoundingClientRect()`로 관찰할 수 있고, Scroll은 viewport event에서 현재 rect를 다시 읽어야 한다.
- Canonical → Screen은 Stage 1의 `canonicalToNormalizedRect`와 `pageRectToScreenRect`를 조합해 재사용한다.
- Toolbar는 별도 Safe Area ref가 없으므로 기존 Toolbar를 감싸는 최소 DOM ref만 추가한다.
- 실제 객체 Focus Store는 없으며 Raw Gaze Timeline도 Scene Object resolver로 연결되어 있지 않다. Phase D Editor wiring은 현재 Selection, 최근 Semantic 후보, Page fallback을 사용하고 Gaze 알고리즘은 변경하지 않는다.
- Voice Controller 소유 수명주기와 React subscriber 수명주기를 분리한다. Composition owner만 dispose하고 `useVoiceTurn`은 unsubscribe만 수행한다.

Phase D 구현 순서:

```text
Editor Scene/Focus read adapter + browser composition
→ useSyncExternalStore subscriber hook
→ pure Voice Lens view model/position resolver
→ Trigger/Lens presentation과 Editor overlay 연결
→ Hook/Component/Geometry 테스트
→ 회귀 검증과 문서 갱신
```

현재 알려진 기존 실패는 Raw Gaze `duplicateFrameCount` 테스트 1개다. 검증 환경은 Node `20.19.4`, 저장소 요구 버전은 Node `>=22`다.

다음 Milestone:

```text
Phase E — Debug Panel, Event Timeline, Frozen/Current Context 비교, Metrics UI, 실제 Editor 통합 검증
```

## 2. 범위

### 포함

- Web Speech Provider
- Provider Contract
- Feature Detection
- Interim/Final 정규화
- Voice Mode
- Voice Turn
- Focus/Scene Freeze
- Voice Lens
- Turn Log
- Debug
- Fake Provider Test
- Chrome Manual Test
- Timing Metric

### 제외

- LLM
- Transcript Refine
- Intent
- CommandPlan
- Direct/Spatial Route
- Capability 실행
- Editor Commit
- Math/Graph/Table 생성
- Audio 저장
- Firefox/Safari 완전 지원
- Server STT 실제 구현

## 3. 선행 조건 점검

| 선행 조건 | 상태 | 실제 위치/이름 | 비고 |
|---|---|---|---|
| SceneSnapshot | CONFIRMED | `packages/editor-core/src/scene-core/types.ts` | PDF/Blank 공통 `SceneSnapshot` |
| SceneRevision | CONFIRMED | `SceneSnapshot.sceneRevision`, `CanvasObjectStore.getSceneRevision()` | 단조 증가 Revision 계약 확인 |
| SceneContextBuilder | CONFIRMED | `packages/editor-core/src/scene-core/scene-context.ts` | `buildSceneContext` 재사용 가능 |
| 현재 Page 조회 | CONFIRMED | `DocumentSessionState.page`, `EditorEngine.getActivePageId()` | 문서/편집기 양쪽 조회 경로 확인 |
| Canonical/Screen Transform | CONFIRMED | `packages/editor-core/src/scene-core/coordinate.ts` | Canonical 좌표 변환 함수 재사용 |
| Gaze Timeline | CONFIRMED | `@ggulnote/interaction-core`, `BrowserInteractionSession.queryGaze()` | 기존 Raw Gaze Timeline 유지 |
| Focus Resolver | MISSING | 없음 | Raw Gaze를 Scene Object Focus로 해석하는 최소 Adapter가 Phase C에 필요 |
| Interaction Clock | CONFIRMED | `@ggulnote/interaction-core`의 `InteractionClock` | Provider timestamp Clock으로 재사용 |
| Debug Route | CONFIRMED | `apps/web/src/app/debug`, `features/debug` | 기존 App Router와 Dashboard 사용 |
| Store Convention | CONFIRMED | `EditorEngine`/구독형 메모리 상태 | Voice 상태도 React 외부 구독 경계로 구현 예정 |

## 4. 구현 진행률

| Workstream | 상태 | 진행 내용 | 남은 작업 |
|---|---|---|---|
| 기존 구조 조사 | DONE | Stage 1 Scene, Raw Gaze Timeline, Selection, Clock, Debug/Test 구조 확인 | Focus Resolver는 Phase C에서 최소 Adapter 필요 |
| Voice Domain | DONE | SPEC의 Config, Availability, Event, Error, Mode, Turn, Focus, Metric 타입 구현 | Phase C Controller에서 재사용 |
| Provider Contract | DONE | 브라우저/React 독립 인터페이스와 `InteractionClock` 호환 Clock 주입 | Web Speech 구현 연결 완료 |
| Web Speech Provider | DONE | Standard/prefix detection, SSR-safe factory, config, event/error 정규화, 세션 격리, 수명주기 구현 | Phrase 오류 후 재시작 정책은 후속 VoiceModeController에서 구현 |
| Fake Provider | DONE | 세션/시간 제어, 전체 정규화 Event helper, 수명주기/호출 기록 구현 | Controller 테스트에서 재사용 |
| Transcript Accumulator | DONE | Segment Map, interim 교체, final lock/dedupe, 정렬/공백 결합, session reset 구현 | Phase C Turn Controller 연결 완료 |
| Voice Mode Controller | NOT STARTED | 자동 Restart와 장기 Mode 수명주기는 별도 Controller 책임으로 유지 | Phase C Turn Controller 완료 후 후속 Milestone에서 연결 |
| Voice Turn Session | DONE | Start/Stop/Cancel, transcript-first, grace/final wait, complete/discard/fail, session 격리 구현 | Phase D React 연결 완료 |
| Focus/Scene Freeze | DONE | EditorEngine/Semantic Model을 조회 시 SceneSnapshot으로 어댑트하고 Selection → Recent Semantic → Page fallback을 speech-start에서 고정 | Raw Gaze의 Scene Object Focus 연결은 실제 source 부재로 Phase E 검증 필요 |
| Voice Lens | DONE | useSyncExternalStore Hook, Trigger, Raw Interim Lens, Frozen canonical anchor, bottom-center fallback, safe clamp 구현 | Chrome 실측과 Debug 좌표 표시는 Phase E 필요 |
| Turn Store | NOT STARTED |  |  |
| Debug | NOT STARTED |  |  |
| Unit Test | DONE | Voice 16 files, 100 tests 통과 | Hook/Trigger/Lens/Position/Editor Adapter 포함 |
| Integration Test | DONE | Fake Provider + 실제 VoiceTurnController UI 흐름 4개 통과 | 실제 Browser Speech Service는 사용하지 않음 |
| Chrome Manual Test | NOT STARTED |  |  |
| Regression | PARTIAL | `editor-core` 47/47 통과, Web 177/178 통과 | 유일한 실패는 기존 Raw Gaze `duplicateFrameCount` |
| Documentation | DONE | D-017, Phase D 체크 상태, 변경 파일, 검증과 제한사항 반영 | Phase E에서 지속 갱신 |

허용 상태:

```text
NOT STARTED
IN PROGRESS
BLOCKED
DONE
PARTIAL
SKIPPED
```

## 5. 결정 변경 기록

| ID | 기존 결정 | 변경 내용 | 이유 | 영향 파일 |
|---|---|---|---|---|
| - | - | - | - | - |

명세 변경이 필요하면 `STAGE2_DECISIONS.md`를 먼저 갱신하고 이 표에 기록한다.

## 6. 변경 파일

### 신규

| 파일 | 역할 |
|---|---|
| `apps/web/src/features/voice/domain/transcript-accumulator.ts` | Session-scoped Segment Map과 Raw Transcript 결합 |
| `apps/web/src/features/voice/domain/transcript-accumulator.test.ts` | Interim/Final, 정렬, 공백, reset, immutable snapshot 테스트 |
| `apps/web/src/features/voice/providers/web-speech-compat.ts` | Browser API 최소 타입, constructor/experimental feature detection, phrase 제한 |
| `apps/web/src/features/voice/providers/web-speech-compat.test.ts` | Standard/prefix/unsupported/local/phrase detection 테스트 |
| `apps/web/src/features/voice/providers/web-speech-recognition-provider.ts` | Web Speech config, 정규화 Event/Error, Session과 lifecycle 구현 |
| `apps/web/src/features/voice/providers/web-speech-recognition-provider.test.ts` | Config, resultIndex, final dedupe, late event, stop/abort/dispose/error 테스트 |
| `apps/web/src/features/voice/providers/web-speech-ssr.test.ts` | Node 환경 import와 unsupported 처리 테스트 |
| `apps/web/src/features/voice/domain/voice-turn-reducer.ts` | 허용된 Turn lifecycle transition만 적용하는 순수 reducer |
| `apps/web/src/features/voice/domain/voice-turn-reducer.test.ts` | 정상/중지/취소/실패/중복 terminal transition 테스트 |
| `apps/web/src/features/voice/application/voice-turn-context-source.ts` | SceneSnapshot과 Focus 후보를 원자적으로 읽는 Context Source/Resolver |
| `apps/web/src/features/voice/application/voice-turn-context-source.test.ts` | Gaze 우선순위, fallback, stale object, canonical bounds 테스트 |
| `apps/web/src/features/voice/application/voice-turn-controller.ts` | Provider Event, transcript, freeze, lifecycle, metric, cleanup 조합 |
| `apps/web/src/features/voice/application/voice-turn-controller.test.ts` | Turn lifecycle, session 격리, stop/cancel/error/metric/timer 테스트 |
| `apps/web/src/features/voice/application/testing/fake-voice-turn-context-source.ts` | Scene/Focus 변경과 capture 오류를 재현하는 테스트 Fake |
| `apps/web/src/features/voice/application/index.ts` | Phase C Application public contract export |
| `apps/web/src/features/voice/hooks/use-voice-turn.ts` | Controller snapshot을 안정적으로 캐시해 `useSyncExternalStore`로 구독하는 subscriber Hook |
| `apps/web/src/features/voice/hooks/use-voice-turn.test.tsx` | State 반영, action 전달, controller 교체, Strict Mode unsubscribe 테스트 |
| `apps/web/src/features/voice/presentation/voice-lens-model.ts` | Turn 상태를 Lens 상태와 정규화 사용자 오류 문구로 변환 |
| `apps/web/src/features/voice/presentation/voice-lens-position.ts` | Canonical Focus 변환, preferred placement, safe clamp, fallback 순수 계산 |
| `apps/web/src/features/voice/presentation/voice-lens.tsx` | Raw Transcript 전용 pointer-events 없는 ephemeral Lens |
| `apps/web/src/features/voice/presentation/voice-trigger.tsx` | Start/Stop/Cancel/Retry/Unsupported 접근성 Control |
| `apps/web/src/features/voice/presentation/*.test.ts(x)` | Trigger, Lens lifecycle, raw text, 위치 정책 단위 테스트 |
| `apps/web/src/features/voice/integration/browser-voice-turn-composition.ts` | InteractionClock, Web Provider, Context Source, Controller composition root |
| `apps/web/src/features/voice/integration/use-owned-browser-voice-turn-controller.ts` | Strict Mode-safe owner lifecycle과 dispose 경계 |
| `apps/web/src/features/voice/integration/editor-voice-context.ts` | Editor annotation/PDF semantic source를 조회 시 SceneSnapshot/Focus로 변환 |
| `apps/web/src/features/voice/integration/voice-trigger-control.tsx` | Trigger와 Controller subscriber 연결 |
| `apps/web/src/features/voice/integration/voice-lens-overlay.tsx` | Frozen Focus, 현재 Page transform, Resize/Scroll, Toolbar safe area 연결 |
| `apps/web/src/features/voice/integration/*.test.ts(x)` | Editor Adapter, owner lifecycle, Fake Provider UI 흐름/Zoom/Page fallback 테스트 |

### 수정

| 파일 | 변경 이유 |
|---|---|
| `apps/web/src/features/voice/domain/index.ts` | Transcript Accumulator 공개 API 추가 |
| `apps/web/src/features/voice/providers/index.ts` | Web Speech Provider와 compatibility API 공개 |
| `apps/web/src/features/voice/index.ts` | Application runtime export 추가 |
| `apps/web/src/features/document/components/document-toolbar.tsx` | 기존 Toolbar에 선택적 Voice Control slot 추가 |
| `apps/web/src/features/document/components/document-workspace.tsx` | Voice composition owner, Scene/Focus reader, Trigger/Lens Editor 연결 |
| `packages/editor-core/src/index.ts` | 기존 Canonical/Screen coordinate helper public export |
| `apps/web/src/features/voice/domain/voice-turn-types.ts` | Frozen Context, Controller state, timestamp/metric/record 계약 확장 |
| `docs/tasks/stage-2-voice-turn/STAGE2_DECISIONS.md` | D-017 owner/fallback/error presentation 정책 기록 |
| `docs/tasks/stage-2-voice-turn/STAGE2_STATUS.md` | Phase C 진행/검증 결과 기록 |
| `docs/tasks/stage-2-voice-turn/STAGE2_CHECKLIST.md` | 검증된 Phase C 항목만 체크 |

### 삭제

| 파일 | 삭제 이유 |
|---|---|
| 없음 |  |

## 7. 테스트 결과

| 명령 | 결과 | 실행 시각 | 비고 |
|---|---|---|---|
| lint | PASS | 2026-08-07 | Voice ESLint, 생성 산출물 제외 전체 소스 ESLint, `@ggulnote/web lint` 통과 |
| typecheck | PASS | 2026-08-07 | Web strict TypeScript 통과 |
| unit test | PASS | 2026-08-07 | Voice 16 files, 100 tests 통과 |
| integration test | PASS | 2026-08-07 | Fake Provider + 실제 Controller 기반 Voice UI 4개 통과 |
| build | PASS | 2026-08-07 | Next.js production build 및 static route 생성 통과 |
| regression | PARTIAL | 2026-08-07 | editor-core 47/47 통과, Web 177/178 통과. 유일한 실패는 기존 Raw Gaze 테스트 |

실제 실행 명령을 아래에 기록한다.

```bash
pnpm --filter @ggulnote/web test -- src/features/voice
pnpm --filter @ggulnote/web typecheck
pnpm --filter @ggulnote/web lint
pnpm --filter @ggulnote/web exec eslint src/features/voice
pnpm --filter @ggulnote/web exec eslint . --ignore-pattern build --ignore-pattern .next
pnpm --filter @ggulnote/web test
pnpm --filter @ggulnote/editor-core test
pnpm --filter @ggulnote/web build
```

기존 실패와 이번 변경으로 발생한 실패를 구분한다.

## 8. Chrome Manual Test

환경:

| 항목 | 값 |
|---|---|
| Chrome Version | 미측정 |
| OS | 미측정 |
| HTTPS/localhost | 미측정 |
| Microphone | 미측정 |
| Recognition Constructor | 미측정 |
| Local Mode | 미측정 |
| Biasing | 미측정 |

결과:

| Test | 결과 | 비고 |
|---|---|---|
| Permission 허용 | NOT RUN |  |
| Permission 거부 | NOT RUN |  |
| 한국어 짧은 명령 | NOT RUN |  |
| 자기 정정 | NOT RUN |  |
| 늦은 Final | NOT RUN |  |
| 연속 10 Turn | NOT RUN |  |
| Scroll/Zoom Lens | NOT RUN |  |
| Gaze Focus Freeze | NOT RUN |  |
| PDF Mode | NOT RUN |  |
| Blank Mode | NOT RUN |  |
| Disable 후 마이크 종료 | NOT RUN |  |

실행 환경이 없어 수동 테스트하지 못하면 `NOT RUN`을 유지하고 재현 절차를 남긴다.

## 9. Latency Measurement

Raw Sample:

| Turn | First Interim ms | First Final ms | End→Complete ms | Interim Updates | Final Segments | Restart |
|---:|---:|---:|---:|---:|---:|---:|
| 1 |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |

Summary:

| Metric | p50 | p95 | 비고 |
|---|---:|---:|---|
| Speech Start → First Interim |  |  |  |
| Speech Start → First Final |  |  |  |
| Speech End → Complete |  |  |  |
| 10 Turn Success Rate |  |  |  |

측정하지 않았다면 숫자를 추정해서 채우지 않는다.

## 10. 알려진 문제와 제한

| ID | 심각도 | 내용 | 재현 | 대응 |
|---|---|---|---|---|
| V-001 | 낮음 | 저장소 요구 Node `>=22`, 검증 환경 Node `20.19.4` | 모든 pnpm 명령에서 engine warning | Node 22 환경에서 최종 검증 필요 |
| V-002 | 중간 | 기존 Raw Gaze restart 테스트의 `duplicateFrameCount` 기대값 실패 | Interaction 테스트 단독 실행 시 5/6 통과 | Phase A 변경 파일과 무관하며 기준 Commit에도 동일 테스트 존재; 별도 Gaze 작업으로 해결 |
| V-003 | 낮음 | Stage 2 문서가 저장소 `.gitignore`의 `docs` 규칙에 포함됨 | `git check-ignore -v` | 변경한 STATUS/CHECKLIST만 명시적으로 Stage 필요 |
| V-004 | 해결 | Web package lint의 이전 timeout | `pnpm --filter @ggulnote/web lint` | Phase C 종료 검증에서 24.3초 내 통과 |
| V-005 | 낮음 | Phrase 미지원 오류 후 1회 재시작은 Provider가 수행하지 않음 | 미지원 Phrase는 생략하고 기본 Recognition은 시작 | D-011에 따라 후속 `VoiceModeController`에서 상한 있는 재시작 정책 구현 |
| V-006 | 낮음 | Web 앱에 SceneSnapshot과 Gaze/Selection Focus를 원자적으로 제공하는 통합 Store가 없음 | Scene Core는 builder 계약만 있고 실제 Editor/Gaze 연결점은 분리됨 | Phase D에서 EditorEngine/Semantic Model 조회 Adapter를 연결했다. Raw Gaze → Scene Object Focus source는 아직 없어 Selection/Recent Semantic/Page fallback을 사용 |
| V-007 | 낮음 | 실제 Desktop Chrome 마이크/권한/한국어 STT와 Lens 체감 검증 미수행 | 현재 환경에서 Browser Speech Service를 실행하지 않음 | Phase E 실제 Editor 통합 검증에서 수동 절차 수행 |
| V-008 | 낮음 | Next build가 상위 `C:\Users\dinda\package-lock.json`을 workspace root 후보로 감지 | `pnpm --filter @ggulnote/web build` warning | 빌드는 성공했으며 Turbopack root 명시 여부는 별도 설정 작업에서 검토 |

예상 제한:

- Browser별 지원 차이
- Chrome Recognition Service의 Network 의존 가능성
- Event 순서 차이
- Local Korean Pack 미지원 가능성
- Contextual Biasing 미지원 가능성
- Permission 복구 UX
- 장시간 Session의 예기치 않은 End

실제 확인 후 상태를 갱신한다.

## 11. 최종 완료 판정

- [x] 브랜치 분리
- [x] Provider 격리
- [ ] Feature Detection
- [ ] Interim/Final 정규화
- [ ] Voice Mode 여러 Turn
- [x] Focus/Scene Freeze
- [x] Voice Lens
- [ ] Audio 미저장
- [ ] LLM/Editor 실행 미포함
- [ ] Debug
- [x] Fake Provider 테스트
- [x] Lint
- [x] Typecheck
- [x] Test
- [x] Build
- [ ] 회귀 검증
- [ ] Chrome Manual Test 또는 명확한 미수행 기록
- [ ] Metric 기록 또는 명확한 미측정 기록
- [ ] Commit

최종 상태:

```text
IN PROGRESS — Phase D 완료, Phase E 대기
```

## 12. 다음 단계 Handoff

3단계 입력:

```text
VoiceTurnRecord
+ Frozen Focus
+ Scene Revision
+ Last Editor Operation
→ Direct Command Planner
→ CommandPlan
→ Capability Registry
→ Editor Commit
```

2단계에서 보존해야 하는 핵심:

- Raw Final Transcript
- Final Segment
- Focus Snapshot
- Scene Revision
- Page ID
- Scene/Page Changed Flag
- Timing Metric
- Provider Error Metadata
