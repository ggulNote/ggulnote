# @ggulnote/interaction-core

이 패키지는 시선 추적 1단계에 필요한 공통 세션 Clock과 시간 기반 Timeline 자료구조만 구현합니다. React state나 DOM API에 의존하지 않으며, 웹캠·Worker·STT 파이프라인은 포함하지 않습니다.

`InteractionClock`에는 호출자가 시간 공급 함수를 주입합니다. 브라우저 연결 단계에서 `() => performance.now()`를 전달할 수 있지만, 패키지를 import하는 순간 `window`나 `performance`에 접근하지 않습니다.

Gaze Timeline의 기준 시각은 벡터 처리 완료 시각이 아니라 원본 프레임의 `RawGazeObservation.sourceCapturedAt`입니다. 예를 들어 10,000ms에 촬영하고 10,032ms에 계산을 마친 결과는 10,000ms에 저장되며, `processingCompletedAt`은 지연 측정에만 사용합니다.

STT는 이후 같은 `InteractionClock`을 사용하되 별도 Speech Buffer로 추가합니다. Gaze, Speech, View State를 하나의 union 배열에 섞지 않습니다.
