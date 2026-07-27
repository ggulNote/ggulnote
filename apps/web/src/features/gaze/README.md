# Gaze Feature (Phase 3)

이 단계는 JEO Python의 `Raw Gaze Vector` 계산 경로를 Next.js 순수 TS로 포팅합니다.
실시간 웹캠 입력은 이전 단계에서 추출한 MediaPipe Face Landmarker 기반 Landmark를 유지합니다.

- Face Landmark는 워커 내부에서 추출 후 `FaceLandmarkFrame`으로 변환됩니다.
- `GazeTracking`은 순수 `@ggulnote/gaze-core`에서 수행됩니다.
- `trackingConfidence`는 MediaPipe에서 신뢰할 수 있는 per-frame 값이 없어 임의 값으로 채우지 않고 `null`로 유지합니다.
- 얼굴 중심/방향은 `RawGazeEngine` 상태로 계산합니다.
  - `leftDirection`
  - `rightDirection`
  - `rawCombinedDirection`
  - `smoothedCombinedDirection`(moving average)
- 결과는 화면 좌표(`screenX/screenY`) 변환 이전 단계가 아니며, 원시 벡터로만 디버그 페이지에 노출합니다.
- Eye Geometry 초기화는 K-Point 보정과 구분되며, 프레임 기준 최신 얼굴 Landmark이 유효할 때만 수행합니다.
- `InteractionClock` 기준 `sourceCapturedAt`은 프레임 수신 시각으로 기록하고, 처리 완료 시각은 별도 기록합니다.

추적 동작은 `interaction-core` 브리지를 사용해 메인 스레드와 worker 시간을 분리하고, worker는 동시에 1개 프레임만 처리합니다.
