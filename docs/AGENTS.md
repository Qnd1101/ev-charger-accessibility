<!-- Parent: ../AGENTS.md -->

# docs

## Purpose

프로젝트 문서: 데이터 출처 표기, 아키텍처 결정 기록(ADR), 에이전트 운영 규칙, 조사 노트. React 화면의 `DataProvenance` 패널이 `docs/data-sources.md`를 직접 임포트(`?raw`)해 렌더링하므로, 이 문서는 문서일 뿐 아니라 UI 콘텐츠의 출처이기도 하다.

## Key Files

| File | Description |
|------|--------------|
| `data-sources.md` | 화면 `DataProvenance` 패널과 README가 함께 참조하는 데이터 출처·저작권 단일 출처. 출처 문구는 여기만 갱신한다 |
| `한국환경공단_전기자동차 충전소 정보_OpenAPI활용가이드_v1.23.docx` | 원 발급기관 API 명세서. `.gitignore`가 `docs/*.docx`를 제외하므로 커밋되지 않는다(공식 배포처에서 재획득 가능). `scripts/build_ref.py`의 입력 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adr/` | 아키텍처 결정 기록 (see `adr/AGENTS.md`) |
| `agents/` | 에이전트 운영 규칙 상세 문서 — 이슈 트래커, triage 라벨, 도메인 문서 사용법 (see `agents/AGENTS.md`) |
| `research/` | 데이터 소스 선행 조사 기록 (see `research/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- `data-sources.md`를 고칠 때는 이용허락범위(공공누리 유형 등)를 원 페이지에서 직접 확인한 것만 적는다. 확인되지 않은 라이선스 유형을 추정해 적지 않는다.
- 각 출처 옆에는 기준일을 표시한다. 충전기·전기차·인구 세 데이터의 기준일이 서로 다르다는 사실 자체가 해석상 중요하다.
- `*.docx` 원문은 커밋하지 않는다(`.gitignore`). 필요하면 공식 배포처에서 다시 받는다.

## Dependencies

### Internal
- `prototype/src/DataProvenance.tsx`가 `docs/data-sources.md`를 `?raw` 임포트로 읽어 화면에 렌더링한다. 이 문서의 마크다운 구조(제목, 링크, 강조)가 바뀌면 `DataProvenance.tsx`의 파서도 함께 확인해야 한다.
