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
| 최종 Commit | 없음 |
| 담당 | Codex |
| MVP Browser | Desktop Chrome |
| 기본 언어 | ko-KR |

## Current Milestone

```text
Phase B — DONE: Web Speech Provider, Feature Detection, Event Normalization, Transcript Accumulator
```

이번 마일스톤에서는 Web Speech 브라우저 어댑터와 Transcript Accumulator만 구현한다. Voice Turn Controller, Voice Lens와 Debug UI는 구현하지 않는다.

다음 Milestone:

```text
Phase C — Voice Turn Controller, State Machine, Context Freeze, Scene Core 통합
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
| Web Speech Provider | DONE | Standard/prefix detection, SSR-safe factory, config, event/error 정규화, 세션 격리, 수명주기 구현 | Phrase 오류 후 재시작 정책은 Phase C Controller에서 구현 |
| Fake Provider | DONE | 세션/시간 제어, 전체 정규화 Event helper, 수명주기/호출 기록 구현 | Controller 테스트에서 재사용 |
| Transcript Accumulator | DONE | Segment Map, interim 교체, final lock/dedupe, 정렬/공백 결합, session reset 구현 | Phase C Turn Session에서 연결 |
| Voice Mode Controller | NOT STARTED |  |  |
| Voice Turn Session | NOT STARTED |  |  |
| Focus/Scene Freeze | NOT STARTED |  |  |
| Voice Lens | NOT STARTED |  |  |
| Turn Store | NOT STARTED |  |  |
| Debug | NOT STARTED |  |  |
| Unit Test | PARTIAL | Voice 6 files, 43 tests 통과 | Phase C 이후 Mode/Turn 테스트 추가 |
| Integration Test | NOT STARTED |  |  |
| Chrome Manual Test | NOT STARTED |  |  |
| Regression | PARTIAL | `editor-core` 47개 통과, Web 120개 통과/기존 Interaction 1개 실패 | 기존 Raw Gaze 실패 별도 해결 필요 |
| Documentation | DONE | Phase B 체크 상태, 변경 파일, 검증과 제한사항 반영 | 다음 Milestone에서 지속 갱신 |

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

### 수정

| 파일 | 변경 이유 |
|---|---|
| `apps/web/src/features/voice/domain/index.ts` | Transcript Accumulator 공개 API 추가 |
| `apps/web/src/features/voice/providers/index.ts` | Web Speech Provider와 compatibility API 공개 |
| `apps/web/src/features/voice/index.ts` | Provider runtime export 추가 |
| `docs/tasks/stage-2-voice-turn/STAGE2_STATUS.md` | Phase B 진행/검증 결과 기록 |
| `docs/tasks/stage-2-voice-turn/STAGE2_CHECKLIST.md` | 검증된 Phase B 항목만 체크 |

### 삭제

| 파일 | 삭제 이유 |
|---|---|
| 없음 |  |

## 7. 테스트 결과

| 명령 | 결과 | 실행 시각 | 비고 |
|---|---|---|---|
| lint | PASS | 2026-08-06 | Phase B 디렉터리와 생성 산출물을 제외한 Web 전체 소스 ESLint 통과. 정확한 package script 최종 재실행 1회는 active Next build 스캔 중 timeout |
| typecheck | PASS | 2026-08-06 | Web strict TypeScript 통과 |
| unit test | PASS | 2026-08-06 | Voice 6 files, 43 tests 통과 |
| integration test | NOT RUN |  |  |
| build | NOT RUN |  |  |
| regression | PARTIAL | 2026-08-06 | editor-core 47/47 통과, Web 120/121 통과. 유일한 실패는 기존 Raw Gaze 테스트 |

실제 실행 명령을 아래에 기록한다.

```bash
pnpm --filter @ggulnote/web test -- src/features/voice
pnpm --filter @ggulnote/web typecheck
pnpm --filter @ggulnote/web lint
pnpm --filter @ggulnote/web exec eslint src/features/voice
pnpm --filter @ggulnote/web exec eslint . --ignore-pattern build --ignore-pattern .next
pnpm --filter @ggulnote/web test
pnpm --filter @ggulnote/editor-core test
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
| V-004 | 낮음 | 정확한 Web package lint 최종 재실행이 active Next dev 산출물을 스캔하며 120초 timeout | `pnpm --filter @ggulnote/web lint` | 동일 변경에 대한 Voice lint와 `build`/`.next` 제외 Web 전체 소스 lint는 통과 |
| V-005 | 낮음 | Phrase 미지원 오류 후 1회 재시작은 Provider가 수행하지 않음 | 미지원 Phrase는 생략하고 기본 Recognition은 시작 | D-011에 따라 Phase C `VoiceModeController`에서 상한 있는 재시작 정책 구현 |

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
- [ ] Focus/Scene Freeze
- [ ] Voice Lens
- [ ] Audio 미저장
- [ ] LLM/Editor 실행 미포함
- [ ] Debug
- [x] Fake Provider 테스트
- [x] Lint
- [x] Typecheck
- [ ] Test
- [ ] Build
- [ ] 회귀 검증
- [ ] Chrome Manual Test 또는 명확한 미수행 기록
- [ ] Metric 기록 또는 명확한 미측정 기록
- [ ] Commit

최종 상태:

```text
IN PROGRESS — Phase B 완료, Phase C 대기
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
