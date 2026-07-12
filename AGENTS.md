# 저장소 에이전트 지침

- 사용자 대화와 설명 문서는 한국어로 작성한다.
- `data/processed/`와 API 스냅샷은 생성 산출물이므로 커밋하지 않는다.
- 수집 API 쿼터를 보호하기 위해 기존 스냅샷이 있으면 `collect.py --force`를 실행하지 않는다.
- 지표 정의는 Python 데이터 파이프라인을 유일한 원본으로 유지하고 UI에서 재구현하지 않는다.
- 새 회귀 테스트는 결함을 주입했을 때 실제로 실패하는지 확인한다.

## Agent skills

### Issue tracker

작업과 스펙은 `Qnd1101/ev-charger-accessibility`의 GitHub Issues에서 관리하며 외부 PR은 triage 요청 표면으로 사용하지 않는다. 자세한 내용은 `docs/agents/issue-tracker.md`를 참고한다.

### Triage labels

기본 영문 라벨 `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`를 사용한다. 자세한 내용은 `docs/agents/triage-labels.md`를 참고한다.

### Domain docs

루트 `CONTEXT.md`와 `docs/adr/`를 사용하는 단일 컨텍스트 구조다. 자세한 내용은 `docs/agents/domain.md`를 참고한다.
