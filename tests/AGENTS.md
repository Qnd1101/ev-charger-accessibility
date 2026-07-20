<!-- Parent: ../AGENTS.md -->

# tests

## Purpose

`src/`(파이프라인)와 `data/ref/`(참조데이터), 그리고 `scripts/build_web_data.py`가 만드는 React용 정적 집계까지 검증하는 pytest 스위트. 원본 API를 호출하지 않고 합성 픽스처로 동작한다.

## Key Files

| File | Description |
|------|--------------|
| `conftest.py` | `src/`를 `sys.path`에 추가하고 `ROOT`/`REF_DIR`/`RAW_DIR`/`KEPCO_PATH` 공용 경로 상수를 제공 |
| `test_collect.py` | 수집 가드 테스트(API 미호출) — API 키 누락 시 종료, `MAX_CALLS` 쿼터 가드 |
| `test_clean.py` | 정제 로직 단위 테스트 — `delYn` 필터, null 정규화, 좌표 검증 |
| `test_metrics.py` | M1~M5 지표 산출 테스트. 손계산 가능한 픽스처로 검증 |
| `test_ref.py` | `data/ref/zscode_map.csv`, `sido_name_map.csv` 검증(17개 시도 전부 매칭) |
| `test_region_bridge.py` | 전남광주통합특별시(zcode 12) → 레거시 광주/전남 정규화 검증 |
| `test_boundary_asset.py` | `data/ref/sigungu.topo.json`의 물리 경계 계약(229개, 세종, 좌표 범위, 도서 지역) 검증 |
| `test_pipeline.py` | 통합 테스트 — 합성 스냅샷으로 `clean.py`→`metrics.py` 전 구간 실제 실행 |
| `test_app.py` | `src/display.py` 순수 함수(격자 집계, 기준일 각주, stat 코드북, 랭킹 계산) 검증. Streamlit 제거 후에도 유지되는 계약 |
| `test_web_data.py` | `prototype/public/data/*.json`(React용 정적 희소 집계)이 Python 지표 값과 일치하는지 계약 테스트 |
| `test_e2e_data_contract.py` | `prototype/e2e/fixtures/build_e2e_fixture.py` 산출물이 손계산 기대값과 일치하는지 검증(Playwright 스위트와 값 소스 공유) |

## For AI Agents

### Working In This Directory

- 새 회귀 테스트는 결함을 주입했을 때 실제로 실패하는지 확인한다(루트 `AGENTS.md`). 예: `test_boundary_asset.py`는 코드 삭제·별칭 도형 복제·좌표계 미변환 등을 실제로 주입해 실패를 확인하는 패턴을 쓴다.
- `stat` 코드표처럼 실데이터가 아니라 공식 명세(활용가이드 공통코드)를 기준으로 검증해야 하는 경우가 있다 — 실데이터 기준이면 현재 0건인 코드가 빠져도 통과해버린다(`test_app.py`의 `STAT_LABELS` 관련 주석 참고).
- 픽스처는 API를 호출하지 않는다. `test_collect.py`는 `MagicMock`/`monkeypatch`로 네트워크를 대체한다.

### Testing Requirements

```bash
python -m pytest tests/ -v          # 전체 스위트
python -m pytest tests/test_metrics.py -v   # 개별 모듈
```

### Common Patterns

- `conftest.py`가 `src/`를 경로에 넣으므로 테스트 파일은 `import metrics`, `import clean`처럼 패키지 프리픽스 없이 임포트한다.
- 손계산 가능한 최소 픽스처(`make_df(**overrides)` 스타일)를 선호하고, 실제 파일 I/O가 필요한 경로만 `test_pipeline.py`에 통합 테스트로 둔다.

## Dependencies

### Internal
- `src/` 전체 모듈, `data/ref/*.csv`, `data/ref/sigungu.topo.json`, `prototype/public/data/*.json`(생성되어 있어야 `test_web_data.py` 통과)

### External
- `pytest>=8.0` (`requirements.txt`)
