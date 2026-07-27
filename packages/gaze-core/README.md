# @ggulnote/gaze-core

이 패키지는 시선 추적 1단계의 프레임, 눈 Geometry, Raw Gaze Observation, Engine State 타입만 정의합니다. 웹캠, MediaPipe, Raw Gaze Vector 계산, 화면 좌표 계산은 아직 포함하지 않습니다.

이후 이식의 기준 구현은 저장소 밖의 JEO Python 프로젝트 `C:\Users\dinda\Desktop\flyAI\eyetracker\EyeTracker`입니다. 해당 프로젝트를 복사하거나 수정하지 않고 참고 구현으로만 사용합니다.

다음 단계에서는 JEO의 최종 `screenX`/`screenY` 변환을 사용하지 않습니다. MediaPipe Web의 Landmark 입력부터 JEO의 `avg_combined_direction`에 해당하는 정규화된 Raw Gaze Vector까지를 TypeScript로 이식하는 것이 연결 목표입니다.
