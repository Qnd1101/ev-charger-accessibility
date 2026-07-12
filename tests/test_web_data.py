"""정적 희소 집계(React 화면용)의 데이터 계약.

화면은 이 파일들만 읽는다. 스키마나 값이 어긋나면 UI 가 **조용히 틀린 숫자**를 띄우므로,
Python 파이프라인의 값과 교차 검증한다. 지표 정의의 원본은 언제나 Python 이다.
"""

from __future__ import annotations

import json

import pandas as pd
import pytest

from conftest import ROOT

DATA_DIR = ROOT / "prototype" / "public" / "data"

# build_web_data.py 의 슬라이스 인코딩
SPEED_ALL, SPEED_FAST, SPEED_SLOW = 0, 1, 2
H24_ALL, H24_ONLY = 0, 1

REGION_COLS = ["zscode", "op", "speed", "h24", "chargers", "stations", "live", "available"]
GRID_COLS = ["lat_e3", "lng_e3", "zcode", "op", "fast", "h24", "chargers"]


def _load(name: str):
    path = DATA_DIR / name
    if not path.exists():
        pytest.skip("희소 집계가 아직 없습니다 -- `python scripts/build_web_data.py`")
    return json.loads(path.read_text())


@pytest.fixture(scope="module")
def clean() -> pd.DataFrame:
    """정제 테이블 **전체**. 익스포터와 같은 dropna 를 여기서 반복하면 안 된다 --
    그러면 '큐브가 행을 잃었는가'를 묻는 검사가 항진명제가 되어 결함을 주입해도 통과한다."""
    path = ROOT / "data" / "processed" / "chargers_clean.parquet"
    if not path.exists():
        pytest.skip("정제 테이블이 아직 없습니다")
    return pd.read_parquet(
        path, columns=["statId", "zscode", "busiNm", "is_fast", "coord_valid", "useTime"]
    )


@pytest.fixture(scope="module")
def placed(clean: pd.DataFrame) -> pd.DataFrame:
    """큐브에 실제로 들어가는 행(지역·운영기관을 아는 행)."""
    return clean.dropna(subset=["zscode", "busiNm"])


@pytest.fixture(scope="module")
def region_cube() -> pd.DataFrame:
    return pd.DataFrame(_load("region_cube.json"), columns=REGION_COLS)


@pytest.fixture(scope="module")
def grid_cube() -> pd.DataFrame:
    return pd.DataFrame(_load("grid_cube.json"), columns=GRID_COLS)


class TestSchema:
    """컬럼 수가 바뀌면 화면의 인덱스 접근이 통째로 밀린다. 조용히 틀리느니 여기서 터진다."""

    def test_region_cube_row_width(self) -> None:
        rows = _load("region_cube.json")
        assert rows and all(len(r) == len(REGION_COLS) for r in rows)

    def test_grid_cube_row_width(self) -> None:
        rows = _load("grid_cube.json")
        assert rows and all(len(r) == len(GRID_COLS) for r in rows)

    def test_meta_keys(self) -> None:
        meta = _load("meta.json")
        required = {
            "snapshot_date", "ev_date", "population_date", "population_label",
            "total_chargers", "invalid_coord_chargers", "grid_deg",
            "top_operators", "station_overcount_max", "unplaced_chargers",
        }
        assert required <= set(meta)

    def test_top_operators_are_ten_and_known(self) -> None:
        meta, ops = _load("meta.json"), _load("operators.json")
        assert len(meta["top_operators"]) == 10
        assert set(meta["top_operators"]) <= set(ops)

    def test_region_reference_covers_every_cube_zscode(self, region_cube: pd.DataFrame) -> None:
        """큐브에만 있고 기준표에 없는 지역이 있으면 랭킹에서 이름 없이 뜬다."""
        regions = {r["zscode"] for r in _load("regions.json")["regions"]}
        assert set(region_cube["zscode"]) <= regions


class TestRegionCubeMatchesPipeline:
    def test_no_charger_is_silently_lost(
        self, region_cube: pd.DataFrame, clean: pd.DataFrame
    ) -> None:
        """큐브 + 미배치 = 정제 행수 전체. 어느 쪽으로도 조용히 새면 안 된다."""
        meta = _load("meta.json")
        base = region_cube.query("speed == @SPEED_ALL and h24 == @H24_ALL")
        assert base["chargers"].sum() + meta["unplaced_chargers"] == len(clean)
        assert meta["total_chargers"] == len(clean)

    def test_national_stations(self, region_cube: pd.DataFrame, placed: pd.DataFrame) -> None:
        """지역·운영기관 방향 합산이 충전소 수를 재현해야 한다(공유 충전소는 알려진 한계)."""
        base = region_cube.query("speed == @SPEED_ALL and h24 == @H24_ALL")
        overcount = _load("meta.json")["station_overcount_max"]
        assert base["stations"].sum() - placed["statId"].nunique() == overcount

    def test_speed_slices_partition_chargers(self, region_cube: pd.DataFrame) -> None:
        """급속 + 완속 == 전체. 어긋나면 속도 필터가 충전기를 잃거나 만든다."""
        by_speed = region_cube.query("h24 == @H24_ALL").groupby("speed")["chargers"].sum()
        assert by_speed[SPEED_FAST] + by_speed[SPEED_SLOW] == by_speed[SPEED_ALL]

    def test_fast_ratio_matches_metrics(self, region_cube: pd.DataFrame, placed: pd.DataFrame) -> None:
        by_speed = region_cube.query("h24 == @H24_ALL").groupby("speed")["chargers"].sum()
        ratio = by_speed[SPEED_FAST] / by_speed[SPEED_ALL]
        assert ratio == pytest.approx(placed["is_fast"].mean(), abs=1e-9)

    def test_h24_slice_is_subset(self, region_cube: pd.DataFrame, placed: pd.DataFrame) -> None:
        only = region_cube.query("speed == @SPEED_ALL and h24 == @H24_ONLY")["chargers"].sum()
        expected = placed["useTime"].str.contains("24시간", na=False).sum()
        assert only == expected

    def test_m2_lowest_region_matches_metrics(self, region_cube: pd.DataFrame) -> None:
        """M2 최하위(접근성 최악)는 화면의 핵심 결론이다. Python 산출물과 일치해야 한다."""
        sgg_path = ROOT / "data" / "processed" / "metrics_sgg.parquet"
        if not sgg_path.exists():
            pytest.skip("시군구 지표가 아직 없습니다")

        sgg = pd.read_parquet(sgg_path)
        expected = sgg.dropna(subset=["M2_chargers_per_100k_pop"]).nsmallest(
            1, "M2_chargers_per_100k_pop"
        )

        pop = {
            r["zscode"]: r["population"]
            for r in _load("regions.json")["regions"]
            if r["population"]
        }
        base = (
            region_cube.query("speed == @SPEED_ALL and h24 == @H24_ALL")
            .groupby("zscode")["chargers"]
            .sum()
        )
        m2 = {z: c / (pop[z] / 100_000) for z, c in base.items() if z in pop}
        lowest = min(m2, key=m2.get)

        assert str(lowest) == expected["zscode"].iloc[0]
        assert m2[lowest] == pytest.approx(
            expected["M2_chargers_per_100k_pop"].iloc[0], rel=1e-9
        )


class TestGridCube:
    def test_chargers_match_valid_coords(self, grid_cube: pd.DataFrame, placed: pd.DataFrame) -> None:
        """격자는 좌표가 유효한 충전기만 담는다. 무효 좌표는 지도에서만 빠지고 집계엔 남는다."""
        assert grid_cube["chargers"].sum() == int(placed["coord_valid"].sum())

    def test_invalid_coord_count_is_reported(self, placed: pd.DataFrame) -> None:
        meta = _load("meta.json")
        assert meta["invalid_coord_chargers"] == int((~placed["coord_valid"]).sum())

    def test_raw_points_are_not_shipped(self, grid_cube: pd.DataFrame, clean: pd.DataFrame) -> None:
        """원본 51만 좌표가 브라우저로 새면 성능 예산이 깨진다(DESIGN.md 성능)."""
        assert len(grid_cube) < len(clean) / 5

    def test_grid_is_snapped_to_2km_cells(self, grid_cube: pd.DataFrame) -> None:
        deg_e3 = int(_load("meta.json")["grid_deg"] * 1000)
        assert (grid_cube["lat_e3"] % deg_e3 == 0).all()
        assert (grid_cube["lng_e3"] % deg_e3 == 0).all()
