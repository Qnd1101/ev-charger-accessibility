"""참조데이터 검증. 여기가 틀리면 지표가 조용히 오염된다."""

from __future__ import annotations

import pandas as pd
import pytest

from conftest import KEPCO_PATH, REF_DIR


@pytest.fixture(scope="module")
def zscode_map() -> pd.DataFrame:
    return pd.read_csv(REF_DIR / "zscode_map.csv", dtype=str)


@pytest.fixture(scope="module")
def sido_map() -> pd.DataFrame:
    return pd.read_csv(REF_DIR / "sido_name_map.csv", dtype=str)


def test_zscode_map_has_230_rows(zscode_map: pd.DataFrame) -> None:
    assert len(zscode_map) == 230
    assert list(zscode_map.columns) == ["zscode", "zcode", "sido", "sigungu"]


def test_zscode_map_known_codes(zscode_map: pd.DataFrame) -> None:
    lookup = zscode_map.set_index("zscode")
    assert lookup.loc["11110", "sigungu"] == "종로구"
    assert lookup.loc["11110", "sido"] == "서울특별시"
    assert lookup.loc["52800", "sigungu"] == "부안군"
    assert lookup.loc["52800", "sido"] == "전북특별자치도"


def test_zscode_codes_are_unique(zscode_map: pd.DataFrame) -> None:
    assert zscode_map["zscode"].is_unique


def test_zscode_prefix_matches_zcode(zscode_map: pd.DataFrame) -> None:
    assert (zscode_map["zscode"].str[:2] == zscode_map["zcode"]).all()


def test_sido_map_has_17_rows(sido_map: pd.DataFrame) -> None:
    assert len(sido_map) == 17
    assert list(sido_map.columns) == ["kepco_name", "zcode", "sido_full"]


def test_sido_map_covers_every_kepco_column(sido_map: pd.DataFrame) -> None:
    """한전 CSV 헤더의 시도 17개가 매핑에 정확히 1:1 대응해야 한다.

    '강원' vs '강원특별자치도' 같은 불일치가 있으면 시도 하나가 조용히 누락된다.
    """
    header = pd.read_csv(KEPCO_PATH, encoding="cp949", nrows=0).columns
    kepco_sidos = set(header) - {"기준일"}

    assert kepco_sidos == set(sido_map["kepco_name"]), (
        f"미매핑: {kepco_sidos ^ set(sido_map['kepco_name'])}"
    )
