# 꿀노트 Agent 2단계 Status

> 완료하지 않은 항목을 완료했다고 기록하지 않는다.

## 1. 기본 정보

| 항목 | 값 |
|---|---|
| 단계 | 2단계: Browser Web Speech 기반 Voice Turn과 Voice Lens |
| 상태 | `IMPLEMENTATION_COMPLETE / VALIDATION_PENDING` |
| 기준일 | 2026-08-07 |
| 작업 브랜치 | `feat/stage-2-voice-turn` |
| Phase F 시작 HEAD | `b0b70f5` |
| Phase A Commit | `a0a02a0` |
| Phase B Commit | `81bddba` |
| Phase C Commit | `0129654` |
| Phase D Commit | `ee08797` |
| Phase E 구현 Commit | `3e42375` |
| Phase E 문서 Commit | `b0b70f5` |
| MVP Browser | Desktop Chrome |
| 기본 언어 | `ko-KR` |

## Current Milestone

~~~text
Phase F - IMPLEMENTATION COMPLETE / VALIDATION PENDING
~~~

Stage 2 코드, 자동 검증, Public API와 diagnostics 경계 정리는 완료했다. Node 22와 실제 한국어 Web Speech 전체 수동 매트릭스가 미검증이므로 Stage 2를 `COMPLETE`로 선언하지 않는다.

## 2. Phase 결과

| Phase | 상태 | 결과 |
|---|---|---|
| A | COMPLETE | Domain, Provider contract, Fake Provider, Clock |
| B | COMPLETE | Web Speech Provider, feature detection, normalization, accumulator |
| C | COMPLETE | VoiceTurnController, lifecycle, context freeze, metrics |
| D | COMPLETE | React integration, Trigger, Lens, Editor composition |
| E | COMPLETE | route-scoped diagnostics, bounded timeline/history, Fake harness |
| F | VALIDATION_PENDING | 최종 코드/문서 정리 완료, Node 22와 전체 Chrome manual 미실행 |

## 3. 최종 Architecture

~~~text
Voice Trigger
→ SpeechRecognitionProvider
→ WebSpeechRecognitionProvider
→ VoiceTurnController
→ speech-start Context Freeze
→ TranscriptAccumulator
→ Voice Lens
→ CompletedVoiceTurn
→ optional best-effort Diagnostics
→ route-scoped read-only Debug UI
~~~

Domain은 React/Browser를 의존하지 않는다. Provider는 Editor UI를 의존하지 않으며, Voice Lens는 SpeechRecognition을 직접 호출하지 않는다. Debug Store는 Production state를 변경하거나 source of truth가 되지 않는다.

## 4. 기존 미커밋 변경 처리

| 변경 | 판정 | 처리 |
|---|---|---|
| `VoiceModeController` | D-011의 bounded restart를 구현한 유효한 Stage 2 내부 모듈 | Stop/Cancel/Disable 시 restart 차단을 보완하고 테스트 포함 |
| `application/index.ts` VoiceMode export | feature 내부 application barrel에는 유효 | 유지하되 feature root public API에서는 제외 |
| Voice Lens style/test | transcript 가독성과 상태 표현을 위한 완성된 Phase D/E 보완 | 테스트와 함께 Stage 2 변경에 포함 |
| Production VoiceMode 연결 | 실제 필요성 미입증 | D-020에 따라 보류, 명시적 Turn Start 유지 |

## 5. Web Speech와 Chrome 관찰

실제 Desktop Chrome의 `/debug/voice`에서 Browser Web Speech provider를 선택했다.

| 항목 | 결과 | 관찰 |
|---|---|---|
| Route/Provider support | PASS | `SpeechRecognition` 및 `webkitSpeechRecognition` 지원, constructor는 `SpeechRecognition` |
| Config | PASS | `ko-KR`, interim, continuous, max alternatives 1 |
| Local/Biasing capability | PASS | Local available/downloadable, contextual biasing 지원 표시 |
| Provider/Audio/Speech start | PASS | 실제 microphone session에서 이벤트 수신 |
| Stop | PASS | intentional stop, speech/audio/provider end, empty transcript discarded |
| Cancel | PASS AFTER FIX | Chrome가 native `end`를 생략해도 logical provider session 즉시 종료 |
| 연속 Session ID | PARTIAL | Cancel 후 새 session ID로 다음 Start 성공, transcript 연속 Turn은 미실행 |
| Basic Korean transcript | NOT RUN | 지정 문장 발화는 미실행 |
| Interim/Final/Self Correction | PARTIAL | 실제 raw interim "안경으로 뭐" 수신, Final과 자기 정정은 미실행 |
| Multi-turn transcript | NOT RUN |  |
| No Speech terminal | NOT RUN | Stop으로 종료했으므로 no-speech 결과로 계산하지 않음 |
| Permission Denied/Recovery | NOT RUN |  |
| Focus Freeze | NOT RUN | 실제 Editor 조작 미실행 |
| Zoom/Resize/Scroll/Page Change | NOT RUN |  |
| PDF/Blank | NOT RUN |  |
| Chrome version | UNKNOWN | 자동화 경계에서 버전 값을 확보하지 못함 |

Chrome 실제 문제로 `abort()` 후 native `end`가 오지 않아 session이 running으로 남는 현상을 재현했다. D-019에 따라 abort 즉시 논리 종료하고 late event를 격리했다. 자동 restart의 Production 연결 필요성은 확인되지 않았다.

## 6. 실제 Latency Sample

실제 Browser Web Speech control run에서 측정한 값만 기록한다.

| Sample | Recognition startup | Audio ready | Speech → First interim | Speech → First final |
|---|---:|---:|---:|---:|
| 1 | 24.5 ms | 304.2 ms | 미측정 | 미측정 |
| 2 | 67.0 ms | 356.7 ms | 2,101.9 ms | 미측정 |

Final transcript가 없어 first-final/total completed turn과 median/p95는 계산하지 않는다. Fake Provider 수치는 포함하지 않는다.

## 7. 자동 검증

| 명령 | 결과 | 비고 |
|---|---|---|
| `pnpm --filter @ggulnote/web test -- src/features/voice` | PASS | 25 files, 154 tests |
| `pnpm --filter @ggulnote/editor-core test` | PASS | 6 files, 47 tests |
| `pnpm --filter @ggulnote/web test` | PARTIAL | 40/41 files, 231/232 tests |
| `pnpm --filter @ggulnote/web typecheck` | PASS | strict TypeScript |
| `pnpm --filter @ggulnote/editor-core typecheck` | PASS | package script |
| `pnpm --filter @ggulnote/web exec eslint src/features/voice src/app/debug/voice` | PASS | Voice와 Debug route |
| `pnpm --filter @ggulnote/web exec eslint . --ignore-pattern build --ignore-pattern .next` | PASS | 전체 source |
| `pnpm --filter @ggulnote/web lint` | PASS | package lint |
| `pnpm --filter @ggulnote/web build` | PASS | `/debug/voice` route 포함 |
| `git diff --check` | PASS | whitespace error 없음 |

Web 전체 테스트의 유일한 실패:

~~~text
BrowserInteractionSession
> clears timeline on restart and rejects duplicated frame id

expected duplicateFrameCount: 1
received duplicateFrameCount: 0
~~~

기존 Raw Gaze 실패이며 Voice 변경에서 Gaze 코드는 수정하지 않았다. 다른 Stage 2 regression은 없다.

## 8. Public API와 Debug Leakage

Feature root는 다음 경계만 공개한다.

- Voice Turn Controller와 context source 계약
- CompletedVoiceTurn 및 소비자용 domain snapshot/type
- SpeechRecognitionProvider 계약
- Browser composition factory
- React hook, Trigger, Lens, Editor integration component

다음은 feature root에서 제외했다.

- TranscriptAccumulator 구현 detail
- Web Speech compatibility/browser implementation detail
- VoiceModeController internal future-ready module
- Fake Provider와 test fixture
- Debug Store 내부 타입

`/debug/voice`만 Fake Provider와 Debug UI를 import한다. 일반 Editor는 Web Speech composition만 사용하고 Debug React tree/history/overlay를 mount하지 않는다.

## 9. Privacy, SSR, StrictMode

- Raw microphone audio, Blob, base64 audio, recording file, IndexedDB/localStorage audio 저장 없음
- 저장하는 값은 transcript, timestamp, context/error metadata, metrics뿐
- Browser raw event 전체 저장 없음
- browser global은 client runtime boundary에서만 접근
- owner hook이 Provider/Controller 생성을 소유하고 subscriber cleanup과 dispose 책임을 분리
- Voice Lens overlay는 Scene Object를 만들지 않고 pointer event를 차단하지 않음

## 10. 환경

| 항목 | 상태 |
|---|---|
| 실행 Node | `20.19.4` |
| 저장소 요구 | Node `>=22` |
| Node 22 validation | NOT RUN - 설치된 runtime 없음 |
| pnpm | `10.9.0` |
| Build warning | 상위 `C:\Users\dinda\package-lock.json` workspace root 추론 경고 |
| Production 기본 Provider | Web Speech |
| Production 자동 Restart | 보류 |
| Audio persistence | 없음 |

## 11. 남은 제한사항

- Node 22 자동 검증 미실행
- 실제 한국어 interim/final/self-correction와 연속 transcript Turn 미실행
- Permission denied/no-speech와 실제 Editor focus/zoom/resize/page/PDF/Blank 수동 검증 미실행
- Raw Gaze duplicate frame 기존 테스트 실패
- LLM, Refine, Intent, Target Resolver, CommandPlan, Editor Action 없음
- Server STT, audio recording/persistence 없음
- Production automatic restart 연결 보류

## 12. 다음 Stage

미검증 항목을 완료해 Stage 2를 `COMPLETE`로 판정한 뒤 다음 개발 단계는 Stage 3 Direct Command Route다.

~~~text
CompletedVoiceTurn
+ Frozen Context
+ Raw Final Transcript
→ Direct Turn Planner
→ CommandPlan
~~~

Stage 3 코드는 이번 Phase에서 구현하지 않았다.
