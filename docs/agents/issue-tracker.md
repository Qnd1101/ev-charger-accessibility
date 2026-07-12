# 이슈 트래커: GitHub

이 저장소의 이슈, 스펙, 구현 티켓은 GitHub Issues에서 관리한다.

- 저장소: `Qnd1101/ev-charger-accessibility`
- CLI: `gh`
- 외부 PR을 요청 표면으로 취급: 아니요
- 스킬이 “이슈 트래커에 게시”하라고 하면 GitHub Issue를 생성한다.
- 관련 티켓을 읽을 때는 본문, 댓글, 라벨을 함께 확인한다.
- 스펙 완료 시 `ready-for-agent` 라벨을 적용한다.
- 인증정보나 API 키는 이슈 본문과 댓글에 기록하지 않는다.

## 주요 명령

```bash
gh issue create --title "제목" --body-file /tmp/body.md
gh issue view <번호> --comments
gh issue list --state open --json number,title,body,labels,comments
gh issue edit <번호> --add-label ready-for-agent
gh issue comment <번호> --body "내용"
gh issue close <번호> --comment "완료 근거"
```

GitHub Issues와 Pull Request는 번호 공간을 공유하므로 번호가 모호하면 `gh pr view`로 먼저 확인하고 실패하면 `gh issue view`를 사용한다.
