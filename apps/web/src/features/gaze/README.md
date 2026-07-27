# Gaze Feature (Phase 2)

이 단계에서는 **실제 웹캠**에서 MediaPipe Face Landmarker를 통해 얼굴 Landmark를 추출하고 디버그 화면에서 시각화합니다.
JEO Python 코드/로직은 가져오지 않고, `Raw Gaze Vector` 계산은 다음 단계로 넘깁니다.

- `FrameScheduler`는 `requestVideoFrameCallback`을 우선 사용하고, 미지원 환경에서는 `requestAnimationFrame`으로 fallback합니다.
- `FaceTrackingSession`은 `InteractionClock`(브라우저는 `performance.now()`로 주입)으로 `sourceCapturedAt`을 기록합니다.
- MediaPipe 추론은 `Web Worker`에서 수행하고, 타임스탬프(`detectForVideo`)는 별도 증가 카운터(`nextMediaPipeTimestamp`)로 관리합니다.
- `sourceCapturedAt`은 작업 완료 시각이 아니라 프레임을 받은 시각(`InteractionClock` 기반)입니다.
- Worker는 동시 처리 1개만 허용하고, 처리 중 새로운 프레임은 가장 최신 프레임만 남기도록 backpressure 처리합니다.
- `trackingConfidence`은 MediaPipe에서 신뢰할 수 있는 값이 없으므로 임의 채움 없이 `null`을 유지합니다.
- `Unsupported landmark layout`은 명시적으로 에러로 구분해 실패를 표시합니다.
- 다음 단계는 `avg_combined_direction`/JEO 기반 시선 벡터 이식입니다.
