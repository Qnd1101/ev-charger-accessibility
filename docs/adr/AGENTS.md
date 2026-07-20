<!-- Parent: ../AGENTS.md -->

# docs/adr

## Purpose

아키텍처 결정 기록(Architecture Decision Records). 되돌리기 어려운 설계 결정과 그 근거·대안·기각 사유를 남긴다. `docs/agents/domain.md`가 탐색 전 필독 문서로 지정한다.

## Key Files

| File | Description |
|------|--------------|
| `0001-sigungu-boundary-and-3d-map.md` | 시군구 경계 코로플레스를 지도 기본 표현으로 채택하고, 3D 기둥을 6개 제약 하에 조건부 허용한 결정. `DESIGN.md` 68행(3D 금지)·132행(코로플레스 열린 질문)을 개정 |
| `.gitkeep` | 디렉터리가 비었을 때도 커밋되도록 유지하는 빈 파일 |

## For AI Agents

### Working In This Directory

- 새로운 도메인 용어나 되돌리기 어려운 결정이 생기면 `/domain-modeling`으로 여기에 ADR을 추가한다(`docs/agents/domain.md`).
- 기존 ADR과 충돌하는 제안은 충돌 사실과 재검토 이유를 명시한다.
- 파일명은 `NNNN-kebab-case-title.md` 형식(4자리 순번)을 따른다.

## Dependencies

### Internal
- ADR 0001은 `DESIGN.md`, `prototype/src/DistributionMap.tsx`, `prototype/src/mapBoundary.ts`의 3D/코로플레스 구현 제약의 근거 문서다.
