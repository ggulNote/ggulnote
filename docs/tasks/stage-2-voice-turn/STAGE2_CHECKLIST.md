# 꿀노트 Agent 2단계 Checklist

> 브랜치 권장: `feat/voice-turn-web-speech`
> 사용법: Codex는 작업하면서 완료 항목을 `[x]`로 바꾸고, 보류나 변경은 해당 항목 아래에 이유를 기록한다.

## A. 작업 안전성과 기준점

- [x] `git status`, 현재 브랜치, 최근 Commit 확인
- [x] 1단계 Scene Core 완료 Commit 확인
- [x] 기존 Working Tree 변경 보존
- [x] Stage 2 새 브랜치 `feat/stage-2-voice-turn` 생성
- [x] `reset --hard`, 강제 clean, 기존 변경 폐기 없음
- [x] 실제 저장소 Script와 Package 이름 확인

## B. 선행 구조 조사

- [x] `SceneSnapshot` 위치 확인
- [x] `SceneRevision` 조회 경로 확인
- [x] `SceneContextBuilder` 확인
- [x] 현재 Page ID 조회 확인
- [x] Canonical ↔ Screen Transform 확인
- [x] Gaze Timeline Clock 확인
- [x] Gaze Focus/ROI 조회 확인
  - Raw Gaze Timeline은 있으나 Scene Object Focus Resolver는 아직 없어 Phase C에서 최소 Adapter가 필요하다.
- [x] Editor Selection 조회 확인
- [x] 최근 Stable Focus 확인
  - 별도 Recent Stable Focus Store는 현재 없다.
- [x] Interaction Clock 재사용 결정
- [x] Editor Resize/Scroll/Zoom 구독 확인
- [x] 기존 `/debug` 구조 확인
- [x] Store Convention 확인
- [x] 테스트 Convention 확인
- [x] 조사 결과를 `STAGE2_STATUS.md`에 기록

## C. Voice Domain

- [x] `SpeechRecognitionConfig`
- [x] `SpeechBiasPhrase`
- [x] `SpeechProviderAvailability`
- [x] `SpeechProviderEvent`
- [x] `SpeechProviderError`
- [x] `VoiceModeState`
- [x] `VoiceTurnState`
- [x] `VoiceTranscriptSegment`
- [x] `VoiceTurnMetrics`
- [x] `VoiceFocusSnapshot`
- [x] `VoiceTurnSceneReference`
- [x] `VoiceTurnRecord`
- [x] Browser/React 독립 Domain 경계

## D. Provider Contract

- [x] `SpeechRecognitionProvider` 정의
- [x] 중복 `start()` 정책
- [x] `stop()`과 `abort()` 구분
- [x] `dispose()` idempotent
- [x] Listener 해제
- [x] Provider Session ID
- [x] Interaction Clock timestamp 정규화
- [x] Raw Browser Event가 Core로 노출되지 않음

## E. Web Speech Provider

- [x] Client Boundary에서만 `window` 접근
- [x] `SpeechRecognition` Detection
- [x] `webkitSpeechRecognition` Fallback
- [x] Unsupported 처리
- [x] `ko-KR`
- [x] `interimResults = true`
- [x] `continuous = true`
- [x] `maxAlternatives = 1`
- [x] `resultIndex`부터 순회
- [x] Stable Segment ID
- [x] Interim 교체
- [x] Final 한 번만 확정
- [x] 이전 Session Segment 혼입 방지
- [x] Error Code 정규화
- [x] Intentional Stop 식별
- [x] Unexpected End 식별
- [x] Strict Mode 중복 Session 방지
- [x] Experimental Type를 최소 범위로 정의

## F. Progressive Enhancement

- [x] `phrases` Feature Detection
- [x] `SpeechRecognitionPhrase` Feature Detection
- [x] Phrase 개수/길이/중복 제한
- [x] Phrase Boost 검증
- [ ] Phrase 미지원 시 한 번만 Fallback
  - Provider는 미지원 Phrase를 생략하고 기본 인식을 계속한다. 재시작 1회 정책은 D-011에 따라 Phase C `VoiceModeController`에서 구현한다.
- [x] `processLocally` Feature Detection
- [x] `available` Feature Detection
- [x] `install` Feature Detection
- [x] Local Pack 자동 설치 없음
- [x] Local 미지원이 기본 Recognition을 막지 않음
- [x] Experimental 기능이 완료 조건을 막지 않음

## G. Fake Provider

- [x] Start/Stop/Abort 기록
- [x] Provider Start Event
- [x] Speech Start Event
- [x] Interim Event
- [x] Final Event
- [x] Speech End Event
- [x] Provider End Event
- [x] Error Event
- [x] Timestamp 제어
- [x] Session ID 제어
- [x] 테스트 초기화

## H. Transcript Accumulator

- [x] Segment Map
- [x] Interim 동일 ID 교체
- [x] Final 확정
- [x] Final → Interim 역행 금지
- [x] Segment Index 정렬
- [x] Final Text 생성
- [x] Interim Text 생성
- [x] Display Text 생성
- [x] Empty Text 처리
- [x] 한글 Whitespace Utility
- [x] 이전 Turn 데이터 초기화
- [x] Unit Test

## I. Voice Mode Controller

- [ ] `off`
- [ ] `starting`
- [ ] `ready`
- [ ] `speech-active`
- [ ] `recovering`
- [ ] `permission-denied`
- [ ] `unsupported`
- [ ] `error`
- [ ] 사용자 Action에서만 Enable
- [ ] Disable은 Intentional Stop
- [ ] Fatal Error 자동 Restart 없음
- [ ] Recoverable Restart 상한
- [ ] Backoff
- [ ] 무한 Restart 없음
- [ ] Turn 완료 후 다음 발화 준비
- [ ] 중복 Enable/Disable 안전

## J. Voice Turn Session

- [x] `speech-start`에서 Turn 생성
- [x] Transcript-first 방어
- [x] Focus Snapshot 고정
- [x] Scene Revision 고정
- [x] Page ID 고정
- [x] Interim Metric
- [x] Final Metric
- [x] `speech-end` → `finalizing`
- [x] Finalization Grace Timer
- [x] Final Wait Timeout
- [x] Final 있음 → Completed
- [x] Final 없음 → Discarded
- [x] Fatal + Final 없음 → Failed
- [x] Final + Error Metadata 정책
- [x] 완료 Turn Record 생성
- [x] 다음 Turn에서 Active 상태 초기화

## K. Focus와 Scene Freeze

- [x] Gaze Focus 우선
- [x] Gaze 신뢰도 필터
- [x] Selection Fallback
- [x] Recent Focus Fallback
- [x] Page Fallback
- [x] None 처리
- [x] Canonical Bounds 저장
- [x] Scene Object 존재 검증
- [ ] Revision mismatch `stale`
- [x] 발화 중 Gaze 이동에도 불변
- [x] Scene 변경 기록
- [x] Page 변경 기록
- [x] Zoom/Scroll은 Screen Anchor만 변경
- [ ] Context Prewarm 실패 격리
- [ ] Prewarm에서 LLM/YOLO/PDF 재파싱 없음

## L. Voice Lens

- [x] `useVoiceTurn`이 Controller를 `useSyncExternalStore`로 구독
- [x] Hook은 subscriber cleanup만 수행하고 owner만 Controller dispose
- [x] React Strict Mode effect replay에서 Provider 자동 시작/조기 dispose 없음
- [x] Voice Trigger Start/Stop/Cancel/Retry
- [x] Unsupported Trigger 비활성화
- [x] 실제 button semantics와 accessible name
- [x] `hidden`
- [x] `listening`
- [x] `transcribing`
- [x] `finalizing`
- [x] `error`
- [x] speech-start 시 표시
- [x] Interim 즉시 갱신
- [x] Final + Interim 조합
- [x] Complete/Discard/Cancel 시 제거, Fail 시 Raw Lens 제거 후 정규화 Error Lens 표시
- [x] Focus 주변 Anchor
- [x] Viewport/Toolbar Clamp
- [x] 화면 밖 하단 중앙 Fallback
- [x] Focus 없음 Fallback
- [x] Zoom/Resize/Scroll 재계산
- [x] Transcript 줄 수 제한
- [x] Raw Text 보존
- [x] Voice Lens가 SceneObject가 아님
- [x] SceneRevision 증가 없음
- [x] PDF 전체 Re-render 없음
- [x] Reduced Motion
- [x] Accessible Status
- [x] 사용자용 오류 문구

## M. Turn Store와 Privacy

- [ ] 최근 N개 Turn 메모리 Store
- [ ] Active Turn 조회
- [ ] 완료 Turn 조회
- [ ] Debug Clear
- [ ] Audio Binary 저장 없음
- [ ] Editor Operation Log와 분리
- [ ] Event Log Ring Buffer
- [ ] Raw Transcript 장기 보관 안 함
- [ ] 개인정보/로그 정책 문서화

## N. Debug

- [ ] Provider 지원 여부
- [ ] Constructor
- [ ] Local/Biasing Availability
- [ ] Provider Session ID
- [ ] Start/End/Restart Count
- [ ] Voice Mode State
- [ ] Active Turn
- [ ] Segment 목록
- [ ] Focus/Scene 정보
- [ ] Voice Lens 상태/좌표
- [ ] Event Timeline
- [ ] Metric
- [ ] Fake Interim/Final
- [ ] Fake Error
- [ ] Fake Focus
- [ ] Fake Scene Change
- [ ] Debug Control이 Production에서 제외됨

## O. 자동 테스트

### Provider

- [x] Standard Constructor
- [x] Prefix Constructor
- [x] Unsupported
- [x] Config
- [x] Result Index
- [x] Interim 교체
- [x] Final 중복 방지
- [x] Session Namespace
- [x] Error 정규화
- [x] Stop/Abort
- [x] Unexpected End
- [x] Dispose
- [x] Strict Mode
- [ ] Phrase Detection/Fallback
  - Detection과 미지원 시 기본 인식 계속은 검증했다. Controller 재시작 Fallback은 Phase C 범위다.
- [x] Local Detection

### Mode/Turn

- [ ] Enable/Disable
- [x] speech-start
- [x] Transcript-first
- [x] Finalizing
- [x] Grace Timer
- [x] Complete
- [x] Discard
- [x] Fail
- [x] Fatal Error
- [ ] Network Recovery
- [ ] Restart 상한
- [x] Intentional Stop
- [x] 다음 Turn 초기화

### Focus/Lens

- [x] Gaze 우선
- [x] Fallback
- [x] Stale
- [x] Focus Freeze
- [x] Scene/Page 변경
- [x] Lens 표시/제거
- [x] Anchor/Fallback
- [x] Resize/Zoom/Scroll
- [x] Reduced Motion
- [x] Store/Revision 불변

## P. 실제 Chrome 수동 테스트

- [ ] 최초 Permission 허용
- [ ] Permission 거부
- [ ] Permission 복구
- [ ] 한국어 짧은 명령
- [ ] 긴 명령
- [ ] 자기 정정
- [ ] 짧은 침묵
- [ ] 늦은 Final
- [ ] 마이크 없음
- [ ] 네트워크 단절
- [ ] 장시간 Voice Mode
- [ ] 연속 10 Turn
- [ ] Scroll
- [ ] Zoom/Resize
- [ ] Gaze 이동
- [ ] PDF Mode
- [ ] Blank Mode
- [ ] Bias Phrase
- [ ] Local Availability
- [ ] Disable 후 마이크 종료

## Q. 계측

- [ ] Speech Start → First Interim
- [ ] Speech Start → First Final
- [ ] Speech End → Complete
- [ ] Interim Update Count
- [ ] Final Segment Count
- [ ] Restart Count
- [ ] 10 Turn 성공률
- [ ] Raw 결과를 `STAGE2_STATUS.md`에 기록
- [ ] 측정하지 못한 경우 미측정으로 명시

## R. 회귀 검증

- [ ] PDF 렌더링
- [ ] Semantic Layer
- [ ] Scene Core
- [ ] Gaze
- [ ] Persistence
- [ ] Autosave
- [ ] Undo/Redo
- [ ] Editor 기본 기능

## S. 검증과 종료

- [x] Lint
- [x] Typecheck
- [x] Unit Test
- [x] Integration Test
- [x] Build
- [x] `git diff` 검토
- [x] 임시 파일/Audio/Transcript Fixture 정리
- [x] `STAGE2_STATUS.md` Phase D 갱신
- [x] 관련 파일만 Stage
- [x] Phase A 논리 커밋 생성 (`a0a02a0`)
- [x] Phase B 논리 커밋 생성 (`81bddba`)
- [x] Phase C 논리 커밋 생성 (`0129654`)
- [x] Phase D 논리 커밋 생성 (`ee08797`)

권장 Commit:

```bash
git commit -m "feat(voice): add web speech voice turns and lens"
```
