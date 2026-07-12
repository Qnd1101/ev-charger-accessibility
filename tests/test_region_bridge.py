"""전남광주통합특별시(zcode 12) -> 레거시 광주(29)/전남(46) 정규화 검증.

2026년 API 에 신설 광역단체가 등장했으나 참조 데이터(한전 EV, 주민등록 인구)는
아직 분리 체계다. 정규화하지 않으면 M1/M2 조인이 조용히 깨진다.
"""

from __future__ import annotations

import pandas as pd
import pytest

import clean
from conftest import REF_DIR
from regions import INCHEON_LEGACY_ZSCODE

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


class TestCanonicalizeIncheon:
    """2026년 인천 개편: 중구+동구 -> 제물포구+영종구, 서구 -> 서해구+검단구.

    전남광주와 달리 1:1 이 아니라 재분할이다. 되돌리지 않으면 신규 구 12,363기가
    M2 에서 NaN 이 되고, 잔여 충전기만 남은 옛 서구가 인구 분모는 그대로 써서
    '접근성 최악 1위'로 잘못 올라온다.
    """

    def _df(self) -> pd.DataFrame:
        return pd.DataFrame({
            "zcode": ["28", "28", "28", "28", "28", "11"],
            "zscode": ["28125", "28155", "28275", "28290", "28185", "11110"],
            "addr": [
                "인천광역시 제물포구 축항대로 1",
                "인천광역시 영종구 공항로 271",
                "인천광역시 서해구 청라대로 1",
                "인천광역시 검단구 신단로 1",
                "인천광역시 연수구 컨벤시아대로 1",
                "서울특별시 종로구 세종대로 1",
            ],
        })

    def test_new_districts_become_legacy(self) -> None:
        out = clean.canonicalize_incheon(self._df())
        assert list(out["zscode"]) == [
            "28110",  # 제물포구 -> 중구
            "28110",  # 영종구   -> 중구
            "28260",  # 서해구   -> 서구
            "28260",  # 검단구   -> 서구
            "28185",  # 연수구는 개편 대상이 아니다
            "11110",
        ]

    def test_zcode_stays_consistent_with_zscode(self) -> None:
        out = clean.canonicalize_incheon(self._df())
        assert (out["zcode"] == out["zscode"].str[:2]).all()

    def test_no_new_district_code_survives(self) -> None:
        out = clean.canonicalize_incheon(self._df())
        assert not out["zscode"].isin(INCHEON_LEGACY_ZSCODE).any()

    def test_new_codes_are_absent_from_reference_map(self) -> None:
        """되돌리는 이유 자체를 고정한다. 참조 맵에 신규 코드가 생기면 이 브리지는 불필요해진다."""
        ref = pd.read_csv(REF_DIR / "zscode_map.csv", dtype=str)
        assert not set(INCHEON_LEGACY_ZSCODE) & set(ref["zscode"])


class TestIncheonPopulationMerge:
    """제물포구가 옛 동구를 흡수했으므로 인구 분모도 중구+동구여야 한다."""

    def test_dong_gu_population_folded_into_jung_gu(self) -> None:
        import metrics

        if not metrics.JUMIN_SGG_PATH.exists():
            pytest.skip("시군구 인구 파일이 아직 없습니다")

        raw = metrics._read_jumin(metrics.JUMIN_SGG_PATH)
        raw["zscode"] = raw["code10"].str[:5]
        jung = int(raw.loc[raw["zscode"] == "28110", "population"].iloc[0])
        dong = int(raw.loc[raw["zscode"] == "28140", "population"].iloc[0])

        pop = metrics.load_population().table
        merged = pop.loc[pop["zscode"] == "28110", "population"]

        assert len(merged) == 1, "중구가 중복 행이면 조인이 이중집계된다"
        assert int(merged.iloc[0]) == jung + dong
        assert "28140" not in set(pop["zscode"]), "동구가 남아 있으면 인구가 이중 계상된다"


class TestRealSnapshotIsCanonical:
    def test_cleaned_data_has_no_incheon_new_codes(self) -> None:
        """정제 산출물에 신규 구 코드가 남아 있으면 M2 에서 12,363기가 증발한다."""
        from conftest import ROOT

        path = ROOT / "data" / "processed" / "chargers_clean.parquet"
        if not path.exists():
            pytest.skip("정제 테이블이 아직 없습니다")

        df = pd.read_parquet(path, columns=["zscode"])
        leaked = sorted(set(df["zscode"].dropna()) & set(INCHEON_LEGACY_ZSCODE))
        assert not leaked, f"되돌려지지 않은 인천 신규 코드: {leaked}"

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
