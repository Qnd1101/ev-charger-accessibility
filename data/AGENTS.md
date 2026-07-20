<!-- Parent: ../AGENTS.md -->

# data

## Purpose

파이프라인의 모든 원본·정제·참조 데이터가 모이는 디렉터리다. `raw/`와 `processed/`는 재생성 가능한 산출물이라 `.gitignore`로 커밋에서 제외되고, `ref/`만 커밋된 참조 자산이다.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `raw/` | API 수집 스냅샷과 원천 CSV(한전 EV, 주민등록 인구). 커밋 제외 (see `raw/AGENTS.md`) |
| `raw/jumin_parts/` | 주민등록 인구 시도별 조각 CSV 17개. `scripts/build_jumin.py` 입력 (see `raw/jumin_parts/AGENTS.md`) |
| `processed/` | `clean.py`·`metrics.py`가 만든 정제·지표 Parquet. 커밋 제외 (see `processed/AGENTS.md`) |
| `ref/` | 시군구/시도 코드 매핑, 지역경계 TopoJSON 등 커밋되는 참조 자산 (see `ref/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- `raw/`와 `processed/`의 내용을 직접 만들지 말고 `src/collect.py` → `src/clean.py` → `src/metrics.py` 파이프라인으로 생성한다.
- `ref/`의 CSV/TopoJSON은 수동 생성 스크립트(`scripts/build_ref.py`, `scripts/build_bridge.py`)의 산출물이므로, 원본 활용가이드나 스냅샷이 바뀌지 않는 한 직접 편집하지 않는다.

### Testing Requirements

- `tests/test_ref.py`, `tests/test_region_bridge.py`, `tests/test_boundary_asset.py`가 이 디렉터리의 데이터 계약을 검증한다.

## Dependencies

### Internal
- `src/collect.py`, `src/clean.py`, `src/metrics.py`, `scripts/build_ref.py`, `scripts/build_bridge.py`, `scripts/build_jumin.py`가 이 디렉터리를 읽고 쓴다.
