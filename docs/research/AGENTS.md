<!-- Parent: ../AGENTS.md -->

# docs/research

## Purpose

데이터 소스 선행 조사 기록. 최종 결정은 `docs/adr/`에 남고, 여기는 그 결정에 이르기까지 확인한 사실·후보·미해결 사항을 원문 링크와 함께 남긴다.

## Key Files

| File | Description |
|------|--------------|
| `sigungu-boundary-source.md` | 시군구 경계 자료 후보 조사(SGIS 2025-06-30 원본 채택, 커뮤니티 데이터·VWorld API 기각 사유, 군위 코드 중복 처리, 확보 후 필수 계약 검증 절차). ADR 0001의 근거 문서 |

## For AI Agents

### Working In This Directory

- 조사 기록은 "확인 사실"과 "추론"을 구분해 표시한다(이 디렉터리 문서의 기존 관례).
- 조사 결과가 결정으로 이어지면 `docs/adr/`에 ADR을 새로 만들고 여기서 링크한다. 조사 기록 자체를 결정 문서로 취급하지 않는다.

## Dependencies

### Internal
- `sigungu-boundary-source.md` ↔ `docs/adr/0001-sigungu-boundary-and-3d-map.md`, `data/ref/sigungu.topo.json.LICENSE`.
