# Scene Core 통합 체크리스트

- 작업 시작 시 SPEC/DECISIONS/STATUS/CHECKLIST 확인
- 현재 Milestone(M2)만 처리
- 기존 미커밋 변경 삭제/초기화 금지

## M1. Scene Core Core

- [x] Canonical geometry 타입(`Point`, `Size`, `Rect`) 추가
- [x] SceneObject union 타입 정의
- [x] 좌표 변환 유틸 구현
- [x] Scene revision 유틸 구현
- [x] CanvasObjectStore API 구현
- [x] PDF Scene Adapter 구현
- [x] Canvas Scene Adapter 구현
- [x] SceneSnapshot 빌더 구현
- [x] OccupancyMap 계산
- [x] Placement Candidate 생성 + validation
- [x] Capability Registry 구현
- [x] Composite Render Snapshot 계약 + stale 처리
- [x] Scene Context Builder 구현
- [x] `/debug` 표시 패널 초안
- [x] 설계 문서(`DESIGN.md`) 작성
- [x] 핵심 유닛 테스트 추가
- [x] 검증: lint/typecheck/test/build 수행
- [x] STATUS/CHECKLIST 업데이트

## M2. Scene Context 배치 연결 (다음 단계)

- [ ] `Speech Start` 시점 scene context 고정
- [ ] 실제 Placement request→commit 파이프라인 연결
- [ ] LLM/Voice/Intent 라우팅 연계
