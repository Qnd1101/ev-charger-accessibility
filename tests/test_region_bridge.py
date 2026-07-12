"""전남광주통합특별시(zcode 12) -> 레거시 광주(29)/전남(46) 정규화 검증.

2026년 API 에 신설 광역단체가 등장했으나 참조 데이터(한전 EV, 주민등록 인구)는
아직 분리 체계다. 정규화하지 않으면 M1/M2 조인이 조용히 깨진다.
"""

from __future__ import annotations

import pandas as pd
import pytest

import clean
from conftest import REF_DIR

BRIDGE_PATH = REF_DIR / "zscode_bridge.csv"


@pytest.fixture(scope="module")
def bridge() -> pd.DataFrame:
    return pd.read_csv(BRIDGE_PATH, dtype=str)


class TestBridgeTable:
    def test_covers_all_27_merged_sigungu(self, bridge: pd.DataFrame) -> None:
        assert len(bridge) == 27

    def test_every_new_code_maps_to_legacy(self, bridge: pd.DataFrame) -> None:
        assert bridge["legacy_zscode"].notna().all()
        assert set(bridge["legacy_zcode"]) == {"29", "46"}

    def test_new_codes_are_all_zcode_12(self, bridge: pd.DataFrame) -> None:
        assert bridge["new_zscode"].str[:2].eq("12").all()

    def test_mapping_is_one_to_one(self, bridge: pd.DataFrame) -> None:
        """1:1 이어야 무손실이다. 하나라도 겹치면 충전기가 이중집계된다."""
        assert bridge["new_zscode"].is_unique
        assert bridge["legacy_zscode"].is_unique

    def test_known_mappings(self, bridge: pd.DataFrame) -> None:
        lookup = bridge.set_index("new_zscode")
        assert lookup.loc["12150", "legacy_zscode"] == "46150"  # 순천시
        assert lookup.loc["12330", "legacy_zscode"] == "29200"  # 광산구
        assert lookup.loc["12210", "legacy_sido"] == "광주광역시"


class TestCanonicalizeRegion:
    def _df(self, **kw) -> pd.DataFrame:
        base = {
            "zcode": ["12", "12", "11"],
            "zscode": ["12150", "12330", "11110"],
            "addr": [
                "전남광주통합특별시 순천시 역전광장1길 4",
                "전남광주통합특별시 광산구 첨단로 1",
                "서울특별시 종로구 세종대로 1",
            ],
        }
        base.update(kw)
        return pd.DataFrame(base)

    def test_merged_codes_become_legacy(self) -> None:
        out = clean.canonicalize_region(self._df())
        assert list(out["zscode"]) == ["46150", "29200", "11110"]
        assert list(out["zcode"]) == ["46", "29", "11"]

    def test_untouched_regions_unchanged(self) -> None:
        out = clean.canonicalize_region(self._df())
        assert out.loc[2, "zscode"] == "11110"  # 서울은 그대로

    def test_name_wins_over_zscode_for_mislabeled_rows(self) -> None:
        """API 에 zscode 12300(북구) 인데 주소는 광산구인 행이 12건 섞여 있다.

        주소의 시군구명을 우선하면 광산구(29200)로 정확히 간다.
        """
        df = pd.DataFrame({
            "zcode": ["12"],
            "zscode": ["12300"],  # 북구 코드
            "addr": ["전남광주통합특별시 광산구 첨단 벤처로 108번길 9"],  # 실제는 광산구
        })
        out = clean.canonicalize_region(df)
        assert out.loc[0, "zscode"] == "29200"  # 북구(29170) 가 아니라 광산구

    def test_no_zcode_12_survives(self) -> None:
        out = clean.canonicalize_region(self._df())
        assert (out["zcode"] == "12").sum() == 0


class TestRealSnapshotIsCanonical:
    def test_cleaned_data_has_no_merged_zcode(self) -> None:
        """정제 산출물에 통합 코드가 남아 있으면 시도 조인이 깨진다."""
        from conftest import ROOT

        path = ROOT / "data" / "processed" / "chargers_clean.parquet"
        if not path.exists():
            pytest.skip("정제 테이블이 아직 없습니다")

        df = pd.read_parquet(path, columns=["zcode"])
        assert (df["zcode"] == "12").sum() == 0
        assert set(df["zcode"].unique()) <= {
            "11", "26", "27", "28", "29", "30", "31", "36",
            "41", "43", "44", "46", "47", "48", "50", "51", "52",
        }
