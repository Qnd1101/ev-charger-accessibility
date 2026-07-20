<!-- Parent: ../AGENTS.md -->

# docs/agents

## Purpose

에이전트가 작업 시 따라야 할 운영 규칙의 상세 문서. 루트 `AGENTS.md`의 "Agent skills" 섹션이 이 세 파일을 요약·링크한다.

## Key Files

| File | Description |
|------|--------------|
| `issue-tracker.md` | 이슈·스펙·구현 티켓을 GitHub Issues(`Qnd1101/ev-charger-accessibility`)에서 관리한다는 규칙과 `gh` CLI 명령 모음. 외부 PR은 요청 표면으로 취급하지 않는다 |
| `triage-labels.md` | 표준 역할 ↔ GitHub 라벨 매핑표(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) |
| `domain.md` | 단일 컨텍스트 구조 사용 규칙 — 탐색 전 `CONTEXT.md`·관련 `docs/adr/`·(UI 작업 시) `DESIGN.md`를 읽으라는 지침과 용어 일관성 규칙 |

## For AI Agents

### Working In This Directory

- 이 문서들은 루트 `AGENTS.md`가 참조하는 대상이다. 내용을 바꾸면 루트 `AGENTS.md`의 요약 문구와 어긋나지 않는지 확인한다.
- GitHub Issue 조작은 `issue-tracker.md`의 `gh` 명령을 그대로 쓴다. 인증정보나 API 키는 이슈 본문/댓글에 기록하지 않는다.
- 새로운 도메인 용어나 되돌리기 어려운 결정이 생기면 `/domain-modeling`으로 `docs/adr/`에 보완한다(`domain.md` 규칙).

## Dependencies

### Internal
- 루트 `/AGENTS.md`의 "Agent skills" 섹션이 이 세 파일을 링크한다.
- `domain.md`가 참조하는 `CONTEXT.md`(루트)와 `docs/adr/`.
