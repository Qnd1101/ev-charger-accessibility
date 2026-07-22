"""E2E 픽스처의 정적 데이터 계약 (Playwright 관찰 시드 3).

`prototype/e2e/fixtures/build_e2e_fixture.py` 가 실제 파이프라인(clean -> metrics ->
build_web_data)을 합성 스냅샷에 돌려 낸 산출물이, 그 합성 스냅샷을 손으로 집계한 값과
일치하는지 확인한다. 스키마는 `tests/test_web_data.py`(레포의 실 산출물 계약)와 같은
필드를 보되, **값**은 이 테스트가 아는 입력 픽스처(서울 종로구 3행 + 부산 중구 2행)에서
독립적으로 손계산한다 -- Playwright 스위트(prototype/e2e/tests)가 브라우저에서 보는 값과
같은 소스여야 한다.
"""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import pytest

from conftest import ROOT

E2E_DIR = ROOT / "prototype" / "e2e"
DATA_DIR = E2E_DIR / ".output" / "public" / "data"

SPEED_ALL, SPEED_FAST, SPEED_SLOW = 0, 1, 2
H24_ALL, H24_ONLY = 0, 1


@pytest.fixture(scope="module", autouse=True)
def built_fixture() -> None:
    """픽스처 산출물이 없으면 여기서 한 번 만든다(Playwright 스위트도 같은 스크립트를 쓴다)."""
    if (DATA_DIR / "meta.json").exists():
        return
    sys.path.insert(0, str(E2E_DIR / "fixtures"))
    build = importlib.import_module("build_e2e_fixture")
    build.main()


def _load(name: str):
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


class TestSchemaMatchesRealContract:
    """tests/test_web_data.py 와 같은 스키마 기대치를 이 작은 픽스처에도 요구한다."""

    def test_meta_keys(self) -> None:
        meta = _load("meta.json")
        required = {
            "schema_version", "snapshot_date", "ev_date", "population_date", "population_label",
            "total_chargers", "invalid_coord_chargers", "grid_deg",
            "top_operators", "station_overcount_max", "unplaced_chargers",
        }
        assert required <= set(meta)
        assert meta["schema_version"] == 1

    def test_region_cube_row_width(self) -> None:
        rows = _load("region_cube.json")
        assert rows and all(len(r) == 9 for r in rows)

    def test_grid_cube_row_width(self) -> None:
        rows = _load("grid_cube.json")
        assert rows and all(len(r) == 7 for r in rows)

    def test_metric_specs_are_shipped(self) -> None:
        specs = {m["id"] for m in _load("metrics.json")}
        assert specs == {"M1", "M2", "M3", "M4", "M5"}


class TestValuesMatchHandComputedFixture:
    """입력 픽스처(합성 5행)를 손으로 집계한 값과 산출물을 대조한다."""

    def test_meta_totals(self) -> None:
        meta = _load("meta.json")
        assert meta["total_chargers"] == 5
        assert meta["invalid_coord_chargers"] == 1  # 부산 중구 B2, 좌표 (0,0)
        assert meta["unplaced_chargers"] == 0
        assert meta["station_overcount_max"] == 0  # statId가 지역·기관 조합에 걸치지 않는다

    def test_operators_are_environment_ministry_and_kepco(self) -> None:
        ops = _load("operators.json")
        assert set(ops) == {"환경부", "한국전력공사"}

    def test_region_cube_national_all_slice_sums_to_five_chargers(self) -> None:
        rows = _load("region_cube.json")
        base = [r for r in rows if r[2] == SPEED_ALL and r[3] == H24_ALL]
        assert sum(r[4] for r in base) == 5  # chargers
        assert sum(r[5] for r in base) == 4  # stations: A1,A2,B1,B2

    def test_region_cube_fast_slow_partition(self) -> None:
        rows = _load("region_cube.json")
        base = {r[2]: r for r in rows if r[3] == H24_ALL and r[1] == 0 and r[0] == 11110}
        # 국가 전체가 아니라 종로구(환경부) 한 지역·기관 슬라이스로 급속/완속 분해를 본다:
        # 종로구 환경부는 row1(급속)+row2(완속) 2행 -> 전체 2, 급속 1.
        assert base[SPEED_ALL][4] == 2
        assert base[SPEED_FAST][4] == 1
        assert base[SPEED_SLOW][4] == 1

    def test_m1_and_m2_hand_calculation(self) -> None:
        """M1(EV1000당), M2(인구10만당)를 픽스처 값으로 손계산해 지표 정의와 교차 검증한다."""
        specs = {m["id"]: m for m in _load("metrics.json")}
        regions = _load("regions.json")

        # 서울: 충전기 3 (row1,row2,row3), EV 3000 -> M1 = 3 / (3000/1000) = 1.0
        seoul = next(s for s in regions["sidos"] if s["zcode"] == 11)
        assert seoul["ev_count"] == 3000
        m1 = specs["M1"]
        seoul_chargers = 3
        assert seoul_chargers / (seoul["ev_count"] / m1["denominator"]["scale"]) == pytest.approx(1.0)

        # 종로구: 충전기 3, 인구 100,000 -> M2 = 3 / (100000/100000) = 3.0
        # 중구: 충전기 2, 인구 50,000 -> M2 = 2 / (50000/100000) = 4.0
        jongno = next(r for r in regions["regions"] if r["zscode"] == 11110)
        junggu = next(r for r in regions["regions"] if r["zscode"] == 26110)
        assert jongno["population"] == 100_000
        assert junggu["population"] == 50_000
        m2 = specs["M2"]
        assert 3 / (jongno["population"] / m2["denominator"]["scale"]) == pytest.approx(3.0)
        assert 2 / (junggu["population"] / m2["denominator"]["scale"]) == pytest.approx(4.0)

    def test_regions_json_still_ships_full_reference_list_for_absent_regions(self) -> None:
        """미진출 지역이 화면 목록에서 사라지지 않으려면 기준표 전체가 실려야 한다."""
        regions = _load("regions.json")
        assert len(regions["regions"]) > 200  # 실제 zscode_map.csv 전체(~230개)
        assert len(regions["sidos"]) == 17
