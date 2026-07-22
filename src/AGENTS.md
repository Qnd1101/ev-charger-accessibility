<!-- Parent: ../AGENTS.md -->

# src

## Purpose

Python 데이터 파이프라인의 핵심 모듈. 수집(`collect.py`)→정제(`clean.py`)→지표 산출(`metrics.py`)의 3단계로 이어지며, 지표 공식(`metric_specs.py`)과 지역코드 상수(`regions.py`)는 이 파이프라인과 `scripts/`, `prototype/`(React)이 공유하는 유일한 원본이다.

## Key Files

| File | Description |
|------|--------------|
| `collect.py` | `getChargerInfo` API 전수 페이징 수집 → `data/raw/chargers_YYYYMMDD.parquet`. `MAX_CALLS=80` 쿼터 가드, 같은 날짜 스냅샷 있으면 skip(`--force`로 강제) |
| `clean.py` | 원본 스냅샷 정제: `delYn='Y'` 제거, null 정규화, 좌표 유효성 검증(`coord_valid`), 급속 판정(`is_fast`), 전남광주·인천 지역코드 정규화, zscode 백필 → `data/processed/chargers_clean.parquet` |
| `metrics.py` | 정제 테이블을 시도/시군구 단위로 집계해 M1~M5 산출. 인구 데이터 해상도(시군구 우선, 없으면 시도)를 자동 판정 → `data/processed/metrics_sido.parquet`, `metrics_sgg.parquet` |
| `metric_specs.py` | **M1~M5 지표 정의의 유일한 원본.** 공식을 코드가 아니라 `MetricSpec` 데이터(분자/분모/스케일/극성/해상도)로 표현해 `to_json()`으로 내보낸다. `apply_metrics()`가 이 표를 파생 열로 적용 |
| `regions.py` | 행정구역 코드 상수의 단일 출처 — 전남광주 통합(zcode 12), 인천 개편 매핑, 세종 특례, 대한민국 좌표 범위 |
| `codebook.py` | 활용가이드 stat 코드북과 약 2km 지도 격자 기준의 단일 출처. 상태 라벨링·격자 집계·랭킹 뷰 순수 계산도 함께 제공 |

## For AI Agents

### Working In This Directory

- **지표 공식을 바꿀 때는 `metric_specs.py`만 고친다.** `metrics.py`, `scripts/build_web_data.py`, `prototype/src/metrics.ts` 어디에도 공식을 재구현하지 않는다(루트 `AGENTS.md`).
- 지역코드 상수(통합·개편·특례)를 추가할 때는 `regions.py`에만 둔다. `clean.py`와 `scripts/build_bridge.py`에 따로 박으면 한쪽만 고치고 넘어가기 쉽다는 것이 `regions.py` 자체의 경고다.
- `clean.py`의 좌표 게이트(`COORD_GATE=0.98`)와 zscode 결측률 게이트(`ZSCODE_GATE=0.02`)는 침묵 실패를 막는 방어 코드다. 게이트 값을 바꾸려면 왜 필요한지(README "데이터 함정" 절)를 먼저 이해한다.
- `metrics.py`의 `aggregate_region()`은 대시보드(과거 Streamlit, 현재는 `scripts/build_web_data.py`를 거쳐 React)도 재사용한다는 전제로 설계됐다 — 필터된 프레임에 다시 적용해야 M3/M5가 필터를 반영한다.

### Testing Requirements

- `python -m pytest tests/ -v`로 전체 스위트 실행.
- 새 회귀 테스트는 결함을 주입했을 때 실제로 실패하는지 확인한다(루트 `AGENTS.md`).
- 대응 테스트: `tests/test_collect.py`, `tests/test_clean.py`, `tests/test_metrics.py`, `tests/test_ref.py`, `tests/test_region_bridge.py`, `tests/test_pipeline.py`(통합), `tests/test_app.py`(codebook.py).

### Common Patterns

- 모든 모듈이 `ROOT = Path(__file__).resolve().parent.parent`로 저장소 루트를 계산하고 그 기준으로 `data/` 경로를 구성한다.
- API/사용자 입력을 예외 메시지에 그대로 반사하지 않는다(`collect.py`의 `resultMsg` 미노출, `from None` 체이닝).
- 조용히 틀리는 것보다 명시적으로 실패하는 것을 우선한다(zscode 결측률 FAIL 시 `RuntimeError`).

## Dependencies

### Internal
- `data/raw/`, `data/ref/`, `data/processed/`
- `scripts/build_bridge.py`, `scripts/build_jumin.py`, `scripts/build_web_data.py`가 이 디렉터리를 임포트한다(`sys.path.insert`).

### External
- `pandas`, `pyarrow`(Parquet), `requests`, `python-dotenv` (`requirements.txt`)
