<!-- Parent: ../AGENTS.md -->

# scripts

## Purpose

파이프라인의 일회성/보조 생성 스크립트 모음. `src/`가 정기 실행되는 핵심 파이프라인(수집→정제→지표)이라면, 여기는 참조데이터 생성·인구 병합·화면용 JSON 내보내기처럼 별도 트리거로 실행되는 스크립트다.

## Key Files

| File | Description |
|------|--------------|
| `build_ref.py` | OpenAPI 활용가이드 `.docx`에서 `data/ref/zscode_map.csv`(시군구 230개), `data/ref/sido_name_map.csv`(시도 17개)를 생성. `--docx <path>` 인자 필요 |
| `build_jumin.py` | `data/raw/jumin_parts/*.csv`(시도별 조각 17개) → `data/raw/jumin_sgg_202606.csv`(시군구 245행) 병합. 일반구·세종 중복 행 제외 |
| `build_bridge.py` | 최신 충전소 스냅샷에서 전남광주통합특별시(zcode 12) → 레거시 광주(29)/전남(46) 매핑을 뽑아 `data/ref/zscode_bridge.csv` 생성 |
| `build_web_data.py` | `data/processed/`와 참조데이터를 읽어 React 화면용 희소 집계(`prototype/public/data/*.json`)를 생성. `region_cube.json`(zscode×운영기관×속도×24시간), `grid_cube.json`(2km셀×시도×운영기관×속도×24시간) 등 |

## For AI Agents

### Working In This Directory

- 이 스크립트들은 서로 독립적이지 않다: `build_ref.py` → `build_bridge.py`/`build_jumin.py` → `src/clean.py`/`src/metrics.py` → `build_web_data.py` 순서로 데이터가 흐른다. 앞 단계 산출물이 없으면 뒤 단계가 실패한다.
- `build_web_data.py`를 수정할 때 지표 공식을 재구현하지 않는다 — `src/metric_specs.py`의 `to_json()`을 그대로 내보낸다(루트 `AGENTS.md`: "지표 정의는 Python 데이터 파이프라인을 유일한 원본으로 유지").
- 각 스크립트는 `sys.path.insert(0, str(ROOT / "src"))`로 `src/` 모듈을 임포트한다. 새 스크립트를 추가할 때도 같은 패턴을 따른다.
- `build_web_data.py`의 `station_count`는 필터 차원에서 합산이 안 된다(한 충전소가 여러 (지역, 운영기관)에 걸칠 수 있음). 슬라이스 설계를 바꿀 때 이 제약을 유지한다.

### Testing Requirements

- `tests/test_web_data.py` — `build_web_data.py` 산출물과 Python 지표 값의 교차 검증(계약 테스트).
- `tests/test_ref.py`, `tests/test_region_bridge.py` — `build_ref.py`/`build_bridge.py` 산출물 검증.
- 실행 검증: `python -m pytest tests/test_web_data.py -v`.

## Dependencies

### Internal
- `src/regions.py`, `src/metrics.py`, `src/metric_specs.py`, `src/codebook.py`
- 입력: `data/raw/`, `data/ref/`, `data/processed/`
- 출력: `data/ref/*.csv`, `prototype/public/data/*.json`
