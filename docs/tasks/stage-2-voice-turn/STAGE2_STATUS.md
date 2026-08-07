# 꿀노트 Agent 2단계 Status

> 완료하지 않은 항목을 완료했다고 기록하지 않는다.

## 1. 기본 정보

| 항목 | 값 |
|---|---|
| 단계 | 2단계: Browser Web Speech 기반 Voice Turn과 Voice Lens |
| 상태 | IN PROGRESS |
| 기준일 | 2026-08-07 |
| 작업 브랜치 | `feat/stage-2-voice-turn` |
| 기준 Commit | `354c76e` |
| Phase A Commit | `a0a02a0` |
| Phase B Commit | `81bddba` |
| Phase C Commit | `0129654` |
| Phase D Commit | `ee08797` |
| Phase E 구현 Commit | `3e42375` |
| Phase E 문서 Commit | 이 문서 커밋 |
| MVP Browser | Desktop Chrome |
| 기본 언어 | ko-KR |

## Current Milestone

~~~text
Phase E — DONE: Voice Debug, integration diagnostics, Fake Provider harness
~~~

Phase E 구현과 자동 검증은 완료했다. 실제 Desktop Chrome 마이크/Web Speech 수동 검증은 실행하지 않았으며 Phase F에서 수행한다.

## 2. Phase E 구현

| 항목 | 상태 | 구현 |
|---|---|---|
| Debug Route | DONE | 기존 App Router 아래 `/debug/voice`, Debug 화면 mount 시에만 React subscription |
| Debug Snapshot | DONE | Phase A~D 타입 기반 read-only view model, Production source of truth로 사용하지 않음 |
| Provider Debug | DONE | ID, 지원/API/config/session/running/intentional stop·abort |
| Voice Turn Debug | DONE | Turn/Session ID, lifecycle/result kind, optional timestamp |
| Transcript Debug | DONE | Raw interim/final과 TranscriptAccumulator read-only segment snapshot |
| Event Timeline | DONE | 단조 증가 sequence, stable ID, 최대 200개 |
| Turn History | DONE | terminal Turn 최근 20개, 메모리 전용 |
| Frozen vs Current | DONE | Page/Scene/Focus 변경과 stale 판정 |
| Bounds Overlay | DONE | Canonical bounds, scene mutation 없음, pointer event 비활성 |
| Lens Position Debug | DONE | anchor/placement/safe rect/final position/clamp/fallback |
| Latency Metrics | DONE | Phase C timestamp 기준 순수 함수, missing은 Not measured |
| Debug Controls | DONE | 실제 VoiceTurnController의 Start/Stop/Cancel/Retry/Clear |
| Fake Provider Harness | DONE | 기존 Fake Provider의 happy/self-correction/error/cancel |
| Privacy | DONE | Browser raw event와 microphone audio/blob/base64 저장 없음 |

Debug observer는 optional best-effort 경계다. observer/listener 예외가 Provider와 Voice Turn 상태 전이를 중단하지 않는다.

## 3. 실제 Pipeline 관찰 위치

~~~text
Voice Trigger
→ SpeechRecognitionProvider
→ VoiceTurnController diagnostics
→ speech-start Context Freeze
→ TranscriptAccumulator snapshot
→ Voice Lens position diagnostics
→ Completed/Discarded/Failed Result
→ bounded Debug Event/Turn Store
~~~

Debug Store는 별도 Voice 상태 머신이 아니다. Core snapshot과 diagnostics event를 읽어 UI용 read model만 만든다.

## 4. Event Timeline

기록 이벤트:

~~~text
TURN_REQUESTED
PROVIDER_START
AUDIO_START
SPEECH_START
CONTEXT_FROZEN
TRANSCRIPT_INTERIM
TRANSCRIPT_FINAL
SPEECH_END
AUDIO_END
STOP_REQUESTED
CANCEL_REQUESTED
PROVIDER_ABORT
PROVIDER_END
PROVIDER_ERROR
TURN_COMPLETED
TURN_DISCARDED
TURN_FAILED
TURN_CANCELLED
~~~

정렬은 `sequence ASC`다. Timestamp는 latency 계산에 사용하고, Transcript event는 result index와 text length 중심의 최소 metadata만 저장한다.

## 5. Editor Integration 검증 수준

| 대상 | 자동 검증 | 실제 Chrome |
|---|---|---|
| PDF/Blank 공통 adapter | PASS | NOT RUN |
| Focus freeze | PASS | Fake Chrome에서 Frozen A / Current B 확인 |
| object revision stale | PASS | NOT RUN |
| Page 변경 fallback | PASS | NOT RUN |
| Zoom screen 재계산 | PASS | NOT RUN |
| Resize clamp | PASS | NOT RUN |
| Scroll screen 재계산 | PASS | NOT RUN |
| Focus 없음 bottom-center | PASS | NOT RUN |

Frozen canonical context는 갱신하지 않고 Current context만 별도로 읽는다. 비교와 위치 계산은 React가 아닌 순수 helper가 담당한다.

## 6. Metrics

- Recognition startup: Turn requested → Provider started
- Audio ready: Turn requested → Audio started
- Speech → First interim
- Speech → First final
- Final after speech end: Final이 Speech End보다 늦을 때만
- Provider end: Speech ended → Provider ended
- Total turn: Turn requested → Completed

실제 Web Speech latency는 측정하지 않았다. Fake Provider delay는 synthetic이므로 실제 Chrome STT sample이나 p50/p95로 기록하지 않는다.

## 7. 테스트 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `pnpm --filter @ggulnote/web test -- src/features/voice` | PASS | 25 files, 154 tests |
| Debug unit/integration | PASS | Voice suite에 포함 |
| Voice UI integration | PASS | Fake Provider + 실제 Controller 4 tests |
| `pnpm --filter @ggulnote/web typecheck` | PASS | strict TypeScript |
| `pnpm --filter @ggulnote/web exec eslint src/features/voice` | PASS | Voice/Debug |
| `pnpm --filter @ggulnote/web exec eslint src/app/debug/voice src/app/debug/page.tsx` | PASS | Debug route |
| `pnpm --filter @ggulnote/web exec eslint . --ignore-pattern build --ignore-pattern .next` | PASS | 전체 source |
| `pnpm --filter @ggulnote/web lint` | PASS | Package lint |
| `pnpm --filter @ggulnote/editor-core test` | PASS | 6 files, 47 tests |
| `pnpm --filter @ggulnote/web test` | PARTIAL | 40/41 files, 231/232 tests |
| `pnpm --filter @ggulnote/web build` | PASS | `/debug/voice` static route 생성 |

Web 전체 테스트의 유일한 실패:

~~~text
BrowserInteractionSession
> clears timeline on restart and rejects duplicated frame id

expected duplicateFrameCount: 1
received duplicateFrameCount: 0
~~~

기존 Raw Gaze 실패이며 Voice 작업에서 Gaze 코드를 수정하지 않았다.

## 8. Chrome Validation

| 항목 | 결과 | 비고 |
|---|---|---|
| `/debug/voice` 렌더 | PASS | 실제 Chrome에서 section/control 확인 |
| Fake Happy Path | PASS | Completed, final transcript, segment, timeline, metrics |
| Frozen vs Current Focus | PASS | 발화 중 current focus 변경 확인 |
| Fake Self Correction | PARTIAL | 브라우저 자동화 중단, Vitest integration PASS |
| Fake Error/Cancel | PASS | Vitest integration |
| Browser Web Speech + 실제 마이크 | NOT RUN | 마이크 상호작용 미실행 |
| 한국어 interim/final | NOT RUN |  |
| Permission/no-speech | NOT RUN |  |
| Zoom/Resize/Scroll | NOT RUN |  |
| PDF/Blank 실제 Editor | NOT RUN |  |

Phase F 수동 확인:

1. Mic permission 허용/거부/복구
2. Korean interim latency와 final 중복
3. speech-start timing과 Frozen Focus
4. PDF/Blank, focus 없음, page 변경
5. Lens placement, zoom, resize, scroll
6. Cancel, no-speech, network error
7. 연속 Turn과 unexpected provider-end

## 9. 환경과 제한사항

| 항목 | 상태 |
|---|---|
| 실행 Node | `20.19.4` |
| 저장소 요구 | Node `>=22` |
| pnpm | `10.9.0` |
| Build warning | 상위 `C:\Users\dinda\package-lock.json` workspace root 추론 경고 |
| LLM/Intent/Command | 구현하지 않음 |
| Editor Command 실행 | 구현하지 않음 |
| Server STT/Audio 저장 | 구현하지 않음 |
| Production 자동 Restart | 최신 D-017에 따라 실제 Chrome 근거 전까지 연결 보류 |
| Production 기본 Provider | Web Speech 유지 |
| Debug Fake Provider | `/debug/voice` route에서만 선택 |

## 10. 다음 Current Milestone

~~~text
Phase F
- Stage 2 전체 회귀 검증
- 실제 Desktop Chrome 최종 검증
- 남은 Checklist 정리
- Public API/export와 dead code/debug leakage 점검
- Node >=22 최종 검증
- 최종 Build
- Stage 2 문서 최종화
- Stage 2 완료 판정
~~~

이번 세션에서는 Phase F와 Stage 3를 구현하지 않는다.
