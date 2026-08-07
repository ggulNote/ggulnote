# 꿀노트 Agent 2단계 Decisions

> 단계: Browser Web Speech 기반 Voice Turn과 Voice Lens
> 기준일: 2026-08-06
> 상태: 구현 전 승인 명세

## 1. 결정 요약

2단계에서는 **Desktop Chrome의 Browser Web Speech API를 기본 STT Provider로 채택**한다.

사용자가 실제 Chrome 환경에서 확인한 빠른 Interim Transcript를 그대로 Voice Lens에 활용한다. 다만 Web Speech API는 브라우저 지원과 내부 Recognition Service가 고정되어 있지 않으므로, 앱의 Voice Core가 브라우저 API에 직접 종속되지 않도록 Provider 계층으로 격리한다.

```text
Voice UI
→ VoiceModeController
→ VoiceTurnSession
→ SpeechRecognitionProvider
→ WebSpeechRecognitionProvider
```

이번 단계의 결과물은 편집 명령이 아니라 다음 단계가 소비할 수 있는 신뢰 가능한 `VoiceTurnRecord`다.

---

## 2. Architecture Decisions

### D-001. Chrome 중심 MVP의 기본 STT로 Web Speech API 채택

**결정**

- 2단계 MVP 필수 환경은 Desktop Chrome이다.
- HTTPS 또는 localhost에서 실행한다.
- 기본 언어는 `ko-KR`이다.
- 짧은 편집 명령과 자기 정정을 포함한 한 번의 발화를 수집한다.

**이유**

- Interim Transcript가 빠르게 도착해 Voice Lens UX에 적합하다.
- 별도 STT 서버, API Key, 과금 없이 음성 UX를 먼저 검증할 수 있다.
- `speechstart`, `speechend`, `result`, `error`, `end` 이벤트로 Voice Turn을 구성할 수 있다.

**제약**

- `SpeechRecognition`은 전체 브라우저 공통 기능으로 간주하지 않는다.
- Chrome의 인식이 네트워크 기반일 수 있으므로 오프라인을 보장하지 않는다.
- Firefox/Safari 지원을 이번 단계 완료 조건으로 두지 않는다.

---

### D-002. Browser API를 Provider 뒤에 격리

React Component, Voice Lens, Voice Turn Core가 다음을 직접 호출하지 않는다.

```ts
window.SpeechRecognition
window.webkitSpeechRecognition
```

Core는 `SpeechRecognitionProvider`의 정규화된 Event만 받는다.

향후 다음 Provider를 추가해도 Voice Mode와 Turn State Machine을 재작성하지 않는 구조로 한다.

- Server Realtime STT
- WebSocket STT
- On-device Model
- 테스트용 Fake Provider

---

### D-003. User Agent가 아니라 Feature Detection 사용

Constructor 선택 순서:

```ts
window.SpeechRecognition
window.webkitSpeechRecognition
```

다음 Experimental 기능도 존재 여부를 직접 검사한다.

- `SpeechRecognitionPhrase`
- `recognition.phrases`
- `recognition.processLocally`
- `SpeechRecognition.available`
- `SpeechRecognition.install`

Experimental 기능이 없어도 기본 Recognition은 동작해야 한다.

---

### D-004. 기본 Recognition 설정

```ts
{
  lang: "ko-KR",
  interimResults: true,
  continuous: true,
  maxAlternatives: 1,
}
```

`continuous: true`의 목적은 장문 회의 전사가 아니다.

- 하나의 발화에서 여러 Final Segment 수집
- 짧은 멈춤 이후 자기 정정 수용
- Voice Mode가 켜진 동안 다음 발화 준비

실제 Voice Turn 경계는 `continuous` 자체가 아니라 다음으로 결정한다.

```text
speech-start
+ speech-end
+ Transcript Events
+ Finalization Grace Timer
```

---

### D-005. Voice Mode와 Voice Turn 분리

```text
Voice Mode
- 사용자가 한 번 켜고 끄는 장기 상태
- Provider 시작, 종료, 제한된 복구 담당

Voice Turn
- 한 번의 발화
- speech-start부터 Final Transcript 확정까지
- Focus, Scene Revision, Transcript, Metric을 묶음
```

사용자는 각 명령마다 마이크 버튼을 다시 누르지 않는다.

---

### D-006. Turn 시작 기준은 `speech-start`

Provider가 시작된 시점이 아니라 실제 음성이 감지된 `speech-start`에서 다음을 고정한다.

- Turn ID
- Speech Start Timestamp
- Focus Snapshot
- Scene Revision
- Page ID
- Transcript Accumulator
- Voice Lens 표시

브라우저 구현 차이로 Transcript가 `speech-start`보다 먼저 도착하는 예외가 확인되면, 첫 Transcript Event 시점에 동일한 초기화 경로를 한 번만 실행하는 방어 로직을 허용한다.

---

### D-007. Focus와 Scene Revision Freeze

한 Voice Turn의 기준은 다음 세 값이다.

```text
speech-start timestamp
+ Frozen Focus Snapshot
+ Scene Revision
```

Focus 우선순위:

1. speech-start 시점에 가장 가까운 유효 Gaze Focus
2. 현재 Selection
3. 최근 Stable Focus
4. Page Focus
5. None

발화 중 시선이 이동해도 Frozen Focus는 변경하지 않는다.

Scene이 변경되면 Turn을 즉시 실패시키지 않고 `sceneChangedDuringTurn`을 기록한다. 다음 단계에서 실행 전 재검증한다.

---

### D-008. Voice Lens는 Raw STT용 Ephemeral UI

Voice Lens는 Agent 해석 결과가 아니다.

```text
speech-start
→ Frozen Focus 주변 표시

Interim
→ 즉시 Raw Text 갱신

speech-end
→ Finalizing 표시

Turn 완료/폐기/실패
→ 제거
```

Voice Lens는 다음 대상이 아니다.

- SceneObject
- Canvas Object
- IndexedDB 문서 객체
- Editor Operation
- LLM 출력 UI

Transcript 갱신 때문에 PDF 전체나 SceneSnapshot을 재렌더링하지 않는다.

---

### D-009. Interim은 교체하고 Final만 확정 저장

Browser Result는 누적 목록일 수 있으므로 단순 문자열 append를 금지한다.

- `event.resultIndex`부터 처리
- Provider Session과 Result Index로 Stable Segment ID 생성
- 동일 Interim Segment는 교체
- Final Segment는 한 번만 확정
- Final이 된 Segment는 Interim으로 되돌리지 않음
- 완료 Turn의 `rawTranscript`에는 Final만 포함
- Interim은 Voice Lens와 Active Turn 상태에만 존재

---

### D-010. `speech-end` 직후 즉시 완료하지 않음

Final Result가 `speech-end` 이후 도착할 수 있으므로 Finalization Grace Timer를 둔다.

```text
speech-end
→ finalizing
→ 늦은 Final 수용
→ Final 있음: completed
→ Final 없음: discarded 또는 failed
```

초깃값은 Config로 분리하고 실제 한국어 발화의 p50/p95 측정 후 조정한다.

---

### D-011. 자동 Restart는 제한적으로 수행

자동 Restart 금지:

- `not-allowed`
- `service-not-allowed`
- `language-not-supported`
- `unsupported`

제한적 복구 후보:

- `network`
- `no-speech`
- 예기치 않은 Provider End

Provider는 Restart를 결정하지 않는다. `VoiceModeController`가 현재 Mode, 오류 성격, 횟수, Backoff를 보고 결정한다.

무한 Restart Loop를 금지한다.

---

### D-012. On-device Recognition은 Progressive Enhancement

`processLocally`, `available`, `install`이 실제로 지원될 때만 사용한다.

초기 기본값은 `browser-default`다.

- `local-preferred`: 가능하면 로컬, 아니면 Browser Default
- `local-required`: 로컬 불가능하면 시작하지 않음
- Language Pack 설치는 사용자 명시적 동작에서만 실행
- `ko-KR` Local Pack이 있다고 가정하지 않음
- Local 실패 시 같은 Turn에서 무한 재시도하지 않음

On-device 지원은 2단계 필수 완료 조건이 아니다.

---

### D-013. Contextual Biasing은 선택 기능

`SpeechRecognitionPhrase`와 `phrases`가 지원될 때만 제한적으로 사용한다.

초기 후보:

- 밑줄
- 하이라이트
- 취소선
- 메모
- 표
- 수식
- 그래프
- 사각형
- 화살표
- Focus 주변 핵심 용어
- 최근 사용 Capability

정책:

- 최대 30개
- Phrase당 최대 40자
- 중복 제거
- 긴 문장과 문서 전체 텍스트 제외
- 미지원 오류 시 Phrase를 제거하고 한 번만 재시작
- `SpeechGrammarList`는 사용하지 않음

Contextual Biasing은 기본 Recognition을 막아서는 안 된다.

---

### D-014. Audio Binary를 저장하지 않음

2단계에서는 다음을 저장하지 않는다.

- 마이크 원본 Audio
- Audio Blob
- Audio Chunk
- 브라우저가 Recognition Service로 보낸 데이터

최근 Voice Turn의 Raw Final Transcript와 Timing Metadata만 메모리에 제한적으로 유지한다.

Voice Turn Log는 Editor Operation Log와 분리한다.

---

### D-015. 2단계에서는 LLM과 편집 실행 금지

이번 단계에서 구현하지 않는다.

- Transcript Refine
- Intent Classification
- LLM 호출
- CommandPlan
- Direct/Spatial Route
- Capability 실행
- Editor Commit
- Math/Graph/Table 생성
- Undo Operation 생성

완료된 `VoiceTurnRecord`만 다음 단계에 전달한다.

---

### D-016. 실제 성능은 계측으로 판단

고정 SLA를 API 보장값처럼 문서화하지 않는다.

최소 Metric:

- Speech Start → First Interim
- Speech Start → First Final
- Speech End → Turn Complete
- Interim Update Count
- Final Segment Count
- Provider Restart Count
- 연속 10 Turn 성공률

실제 Chrome의 한국어 발화로 p50/p95를 계산할 수 있도록 Raw Metric을 남긴다.

---

### D-017. React 소유권과 Voice Lens Fallback 정책

**문제**

- React subscriber unmount와 Controller owner unmount를 같은 수명주기로 취급하면 Strict Mode effect replay에서 활성 Controller가 조기에 dispose될 수 있다.
- Frozen Page가 화면에서 사라지거나 Focus Bounds가 없을 때 Lens를 현재 Focus로 다시 붙이면 Context Freeze 의미가 깨진다.
- D-008의 terminal Lens 제거와 오류 피드백 요구를 함께 만족할 표현 정책이 필요하다.

**선택한 방식**

- `useVoiceTurn`은 `useSyncExternalStore` 구독과 User Intent 전달만 담당하고 Controller를 dispose하지 않는다.
- Browser composition owner hook만 Provider/Controller를 생성하고 실제 owner unmount에서 dispose한다. Strict Mode effect replay는 generation 검증 후 무시한다.
- Frozen Page와 현재 Page가 같고 Frozen Canonical Bounds가 유효할 때만 Focus Anchor를 사용한다.
- Focus 없음, stale Focus, 화면 밖 Focus, Page 변경은 Editor usable viewport의 `bottom-center` Fallback을 사용하며 현재 Focus로 재고정하지 않는다.
- 실패 시 Raw Transcript Lens는 종료하고, 동일 Overlay 자리에 정규화된 사용자용 Error Lens를 Retry 전까지 표시한다. Complete/Discard/Cancel은 즉시 숨긴다.

**선택 이유**

- Controller를 React 표현 상태와 분리해 Provider 중복 생성과 조기 dispose를 막는다.
- Frozen Context는 불변으로 유지하면서 Zoom/Resize/Scroll에 따른 Screen Position만 갱신할 수 있다.
- Browser Raw Error를 노출하지 않고 재시도 가능한 접근성 피드백을 제공한다.

**고려한 대안**

- Hook cleanup마다 Controller dispose
- Page 변경 시 Current Focus로 Lens 재부착
- Focus가 없으면 Lens 숨김
- Error를 timer로 자동 dismiss

**포기한 대안**

- 위 대안은 Strict Mode 수명주기, Context Freeze, No-focus 피드백 또는 Retry UX를 훼손하므로 채택하지 않는다.

**후속 영향**

- Phase E Debug Panel은 Frozen Anchor와 Fallback 여부를 함께 표시한다.
- VoiceModeController의 제한적 Restart 정책은 계속 보류하며 Error Lens가 자동 Restart를 수행하지 않는다.

---

### D-018. Debug diagnostics는 read-only best-effort observer

**선택한 방식**

- `VoiceTurnController`는 optional diagnostics observer로 accepted provider event, control event, state transition만 전달한다.
- observer 실패는 catch하고 Voice Turn lifecycle을 계속한다.
- Debug Snapshot은 Phase A~D 타입을 참조하는 read-only view model이며 Production state의 source of truth가 아니다.
- Event Timeline은 sequence 기반 최대 200개, Turn History는 최대 20개의 메모리 전용 store다.
- Browser raw event와 audio data는 저장하지 않는다.
- 기존 Fake Provider는 `/debug/voice` route에서만 harness로 조합하고 Production Editor 기본 Provider는 Web Speech로 유지한다.

**선택 이유**

Core state machine을 복제하거나 Debug UI 요구를 Production state 계약에 섞지 않으면서, 실제 pipeline의 순서와 context freeze를 관찰하기 위해서다.

**후속 영향**

Phase F에서는 debug route가 닫힌 일반 Editor 경로의 bundle/subscription leakage와 public export를 최종 점검한다.

### D-019. Abort는 브라우저 `end`를 기다리지 않고 논리 세션을 종료한다

**문제**

Desktop Chrome 실제 검증에서 `SpeechRecognition.abort()` 후 native `end`가 발생하지 않아 Provider가 running/session 상태를 유지하고 다음 명시적 Start를 막는 사례가 재현됐다.

**선택한 방식**

- `abort()` 호출의 `finally`에서 현재 Provider 세션을 즉시 논리 종료한다.
- intentional `provider-end`를 한 번 발행하고 handler와 active session을 해제한다.
- 이후 도착하는 native `end`는 stale session event로 무시한다.
- Debug read model도 Cancel 즉시 `isRunning = false`로 표시한다.

**선택 이유**

Cancel은 완료 결과를 만들지 않으면서 다음 Turn을 즉시 시작할 수 있어야 하고, 브라우저별 native `end` 전달 차이에 의존하면 안 된다.

**후속 영향**

Provider unit test는 native `end` 없는 abort, 다음 session 시작, late `end` 격리를 검증한다.

---

### D-020. VoiceModeController는 내부 모듈로 완성하되 Production 연결은 보류한다

**선택한 방식**

- 제한된 recoverable restart, backoff, restart 상한을 가진 기존 모듈과 테스트를 Stage 2 변경으로 보존한다.
- 사용자 Stop, Cancel, Disable은 mode를 `off`로 바꾸고 pending restart를 제거한다.
- permission denied, unsupported, fatal error, dispose 후에는 restart하지 않는다.
- Feature root에서는 export하지 않고 Production Editor에도 연결하지 않는다.

**선택 이유**

모듈은 D-011의 상위 restart 책임을 구현하지만 실제 Chrome 검증에서 단일 Turn 동작을 위해 자동 restart가 필요하다는 근거는 확보되지 않았다. Production 연결은 무한 restart와 의도치 않은 마이크 재활성화 위험을 만든다.

**후속 영향**

Stage 3 전에도 Production은 명시적 Voice Trigger Start를 사용한다. 자동 Voice Mode가 실제 제품 요구가 될 때 별도 검증 후 composition에 연결한다.

---
## 3. MVP 지원 정책

### 필수 지원

- Desktop Chrome
- HTTPS 또는 localhost
- `ko-KR`
- Permission 허용
- Interim Transcript
- Final Transcript
- 연속 Voice Turn
- PDF Mode
- Blank Mode

### Graceful Degradation

지원되지 않거나 권한이 없으면:

- 앱 전체는 계속 동작
- Voice 기능만 비활성화
- 명확한 안내 표시
- Provider 교체 가능한 Domain 상태 유지

### 비보장

- Firefox 완전 지원
- Safari 완전 지원
- 모든 Chrome 버전의 동일 이벤트 순서
- Offline Recognition
- `ko-KR` On-device Pack
- Contextual Biasing
- 장시간 회의 전사
- 다중 화자 분리
