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
- [ ] Editor Resize/Scroll/Zoom 구독 확인
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

- [ ] Client Boundary에서만 `window` 접근
- [ ] `SpeechRecognition` Detection
- [ ] `webkitSpeechRecognition` Fallback
- [ ] Unsupported 처리
- [ ] `ko-KR`
- [ ] `interimResults = true`
- [ ] `continuous = true`
- [ ] `maxAlternatives = 1`
- [ ] `resultIndex`부터 순회
- [ ] Stable Segment ID
- [ ] Interim 교체
- [ ] Final 한 번만 확정
- [ ] 이전 Session Segment 혼입 방지
- [ ] Error Code 정규화
- [ ] Intentional Stop 식별
- [ ] Unexpected End 식별
- [ ] Strict Mode 중복 Session 방지
- [ ] Experimental Type를 최소 범위로 정의

## F. Progressive Enhancement

- [ ] `phrases` Feature Detection
- [ ] `SpeechRecognitionPhrase` Feature Detection
- [ ] Phrase 개수/길이/중복 제한
- [ ] Phrase Boost 검증
- [ ] Phrase 미지원 시 한 번만 Fallback
- [ ] `processLocally` Feature Detection
- [ ] `available` Feature Detection
- [ ] `install` Feature Detection
- [ ] Local Pack 자동 설치 없음
- [ ] Local 미지원이 기본 Recognition을 막지 않음
- [ ] Experimental 기능이 완료 조건을 막지 않음

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

- [ ] Segment Map
- [ ] Interim 동일 ID 교체
- [ ] Final 확정
- [ ] Final → Interim 역행 금지
- [ ] Segment Index 정렬
- [ ] Final Text 생성
- [ ] Interim Text 생성
- [ ] Display Text 생성
- [ ] Empty Text 처리
- [ ] 한글 Whitespace Utility
- [ ] 이전 Turn 데이터 초기화
- [ ] Unit Test

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

- [ ] `speech-start`에서 Turn 생성
- [ ] Transcript-first 방어
- [ ] Focus Snapshot 고정
- [ ] Scene Revision 고정
- [ ] Page ID 고정
- [ ] Interim Metric
- [ ] Final Metric
- [ ] `speech-end` → `finalizing`
- [ ] Finalization Grace Timer
- [ ] Final Wait Timeout
- [ ] Final 있음 → Completed
- [ ] Final 없음 → Discarded
- [ ] Fatal + Final 없음 → Failed
- [ ] Final + Error Metadata 정책
- [ ] 완료 Turn Record 생성
- [ ] 다음 Turn에서 Active 상태 초기화

## K. Focus와 Scene Freeze

- [ ] Gaze Focus 우선
- [ ] Gaze 신뢰도 필터
- [ ] Selection Fallback
- [ ] Recent Focus Fallback
- [ ] Page Fallback
- [ ] None 처리
- [ ] Canonical Bounds 저장
- [ ] Scene Object 존재 검증
- [ ] Revision mismatch `stale`
- [ ] 발화 중 Gaze 이동에도 불변
- [ ] Scene 변경 기록
- [ ] Page 변경 기록
- [ ] Zoom/Scroll은 Screen Anchor만 변경
- [ ] Context Prewarm 실패 격리
- [ ] Prewarm에서 LLM/YOLO/PDF 재파싱 없음

## L. Voice Lens

- [ ] `hidden`
- [ ] `listening`
- [ ] `transcribing`
- [ ] `finalizing`
- [ ] `error`
- [ ] speech-start 시 표시
- [ ] Interim 즉시 갱신
- [ ] Final + Interim 조합
- [ ] Complete/Discard/Fail 시 제거
- [ ] Focus 주변 Anchor
- [ ] Viewport/Toolbar Clamp
- [ ] 화면 밖 하단 중앙 Fallback
- [ ] Focus 없음 Fallback
- [ ] Zoom/Resize/Scroll 재계산
- [ ] Transcript 줄 수 제한
- [ ] Raw Text 보존
- [ ] Voice Lens가 SceneObject가 아님
- [ ] SceneRevision 증가 없음
- [ ] PDF 전체 Re-render 없음
- [ ] Reduced Motion
- [ ] Accessible Status
- [ ] 사용자용 오류 문구

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

- [ ] Standard Constructor
- [ ] Prefix Constructor
- [ ] Unsupported
- [ ] Config
- [ ] Result Index
- [ ] Interim 교체
- [ ] Final 중복 방지
- [ ] Session Namespace
- [ ] Error 정규화
- [ ] Stop/Abort
- [ ] Unexpected End
- [ ] Dispose
- [ ] Strict Mode
- [ ] Phrase Detection/Fallback
- [ ] Local Detection

### Mode/Turn

- [ ] Enable/Disable
- [ ] speech-start
- [ ] Transcript-first
- [ ] Finalizing
- [ ] Grace Timer
- [ ] Complete
- [ ] Discard
- [ ] Fail
- [ ] Fatal Error
- [ ] Network Recovery
- [ ] Restart 상한
- [ ] Intentional Stop
- [ ] 다음 Turn 초기화

### Focus/Lens

- [ ] Gaze 우선
- [ ] Fallback
- [ ] Stale
- [ ] Focus Freeze
- [ ] Scene/Page 변경
- [ ] Lens 표시/제거
- [ ] Anchor/Fallback
- [ ] Resize/Zoom/Scroll
- [ ] Reduced Motion
- [ ] Store/Revision 불변

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
- [ ] Integration Test
- [ ] Build
- [x] `git diff` 검토
- [ ] 임시 파일/Audio/Transcript Fixture 정리
- [ ] `STAGE2_STATUS.md` 최종 갱신
- [x] 관련 파일만 Stage
- [ ] Commit 생성

권장 Commit:

```bash
git commit -m "feat(voice): add web speech voice turns and lens"
```
