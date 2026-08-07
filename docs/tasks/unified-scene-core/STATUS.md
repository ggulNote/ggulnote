# Scene Core 통합 - 현재 상태

## Branch

`feat/unified-scene-core`

## Current State

- 문서 조사(SPEC/DECISIONS 참조) 및 구조 분석 완료.
- `M1 Scene Core 핵심 구성` 핵심 산출물을 구현.
- editor-core 공유 타입/스토어/어댑터/컨텍스트/Placement/Registry/스냅샷 계약을 적용.
- `/debug` Scene Core 패널 및 sample 객체/occupancy/candidate/snapshot JSON 노출 추가.
- `DESIGN.md` 작성 완료.

## Completed Milestone

`M1` 완료.

## Known Problems

- 현재 웹 단위 테스트 전체에서 기존 `@ggulnote/web` 테스트 1건(`clears timeline on restart...`)이 실패하는 기존 이슈 존재.
  - 본 단계 코드와는 독립이며, 이전 상태에서도 재현되는 `@ggulnote/web` 단일 실패.
- Node 엔진 경고(`>=22` 권장, 현재 실행 환경 v20)로 환경 차이에 따른 경고 출력.

## Current Milestone

`M2` - Scene Context 기반 배치/캡처/Capability 실행 연결

## Next Milestone

`M2`에서는 다음을 연결:

- `Speech Start` 시 `sceneRevision` 고정 및 focus 고정
- Scene Context/Placement 결과를 이용한 실제 배치 요청/검증
- Realtime STT/Voice Lens/Intent 연계
