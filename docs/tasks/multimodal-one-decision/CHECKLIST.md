# Multimodal One Decision - Checklist

## M1 - Page context foundation

- [x] 시작 전 branch/worktree 확인
- [x] 원격 기준 branch 존재 여부 확인
- [x] 기존 미커밋 변경을 보존한 새 branch 생성
- [x] 실제 production 실행 경로 조사
- [x] `/canvas`, `/editor`, tldraw, PDF semantic projection 조사
- [x] world/catalog/prompt/schema/runtime/action/math/text/placement/screenshot 조사
- [x] `PageBaseSnapshot` / `LiveSceneContext` 타입 추가
- [x] page별 stable handle과 immutable base cache 구현
- [x] create/update/delete live projection 구현
- [x] prompt input 순서 정리
- [x] page base/live/prompt ordering 단위 테스트
- [x] web typecheck/test/lint
- [x] STATUS/CHECKLIST 완료 상태 갱신

## M1 검증 결과

- [x] `pnpm --filter @ggulnote/web typecheck`
- [x] `pnpm --filter @ggulnote/web lint`
- [x] M1 context/schema/provider 단위 테스트 - 42/42 통과
- [x] production route/tldraw sequential 통합 테스트 - 14/14 통과
- [ ] 전체 web test - 1024 통과, 기존 `editor-shell.test.tsx` 4건 실패
- [x] `git diff --check`

## M2 - Marked multimodal snapshot

- [x] 시작 전 branch/worktree 및 M1 완료 상태 확인
- [x] agent 전용 offscreen handle overlay
- [x] screenshot/catalog ID consistency
- [x] structured + visual one-call 연결
- [x] capture unavailable/stale/marker mismatch structured-only 저하
- [x] marked screenshot development trace
- [x] STATUS/CHECKLIST 완료 상태 갱신

## M2 검증 결과

- [x] `pnpm --filter @ggulnote/web typecheck`
- [x] `pnpm --filter @ggulnote/web lint`
- [x] M2 screenshot/schema/provider/production 단위 테스트 - 55/55 통과
- [x] 기존 placement/image processor 회귀 테스트 - 30/30 통과
- [x] tldraw sequential production 통합 테스트 - 5/5 통과
- [ ] 전체 web test - 최초 1026 통과, 5 실패; 새 sequential timeout은 harness 보완 후 5/5 재통과, 기존 `editor-shell.test.tsx` 4건만 남음
- [x] `git diff --check`

## M3 - Target resolver

- [x] 시작 전 branch/worktree 및 M2 완료 상태 확인
- [x] object target
- [x] object-local normalized region
- [x] fallback point
- [x] deterministic grounding trace
- [x] registered text/shape/math tool 연결
- [x] local circle geometry와 tangent quadrant constraint 회귀 검증
- [x] STATUS/DECISIONS/CHECKLIST 완료 상태 갱신

## M3 검증 결과

- [x] `pnpm --filter @ggulnote/web typecheck`
- [x] `pnpm --filter @ggulnote/math-core typecheck`
- [x] `pnpm --filter @ggulnote/web lint`
- [x] `pnpm --filter @ggulnote/math-core lint`
- [x] M3 target/schema/provider/runtime/tool 집중 테스트 - 85/85 통과
- [x] 신규 math action 집중 테스트 - 1/1 통과
- [x] 전체 math-core test - 41/41 통과
- [ ] 전체 web test - 1036/1040 통과, 기존 `editor-shell.test.tsx` 4건은 jsdom `image.decode is not a function`으로 실패
- [x] `git diff --check`

## M4 - One-call cleanup

- [x] invalid PDF range repair LLM 재호출 제거
- [x] Note Agent disambiguation provider/prompt와 second-pass candidate selection 제거
- [x] Note Agent placement VLM/ghost preview 재호출 제거
- [x] production runtime을 strict `READY.steps[]`로 제한
- [x] local PDF fuzzy semantic repair 우회/삭제
- [x] production schema에서 `NEEDS_VISUAL`/candidate/crop 계약 제거
- [x] visual 부족 시 same-decision `NEEDS_CLARIFICATION(VISUAL_UNRESOLVED)` 계약 적용
- [x] parser-only `NEEDS_VISUAL` production runtime 차단
- [x] end-to-end regression
- [ ] 실제 OpenAI live eval - 현재 환경에 API key/model 없음
- [x] STATUS/DECISIONS/CHECKLIST 완료 상태 갱신

## M4 검증 결과

- [x] `pnpm --filter @ggulnote/web typecheck`
- [x] `pnpm --filter @ggulnote/web lint`
- [x] M4 provider/runtime/placement/API/E2E 집중 테스트 - 78/78 통과
- [x] `NEEDS_VISUAL` 제거 후 schema/provider/runtime 집중 테스트 - 23/23 통과
- [x] 전체 Note Agent 회귀 테스트 - 110/110 통과
- [ ] 전체 web test - 1036/1040 통과, 기존 `editor-shell.test.tsx` 4건은 jsdom `image.decode is not a function`으로 실패
- [x] one-call/no-preview spy regression으로 추가 model 호출이 없음을 검증
- [x] `git diff --check`
