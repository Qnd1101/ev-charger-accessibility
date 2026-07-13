"""표시 계층(display.py) 순수 함수 검증.

Streamlit 대시보드는 React 로 대체되며 제거됐다. 여기서는 데이터 파이프라인이
표시용으로 노출하는 순수 함수(격자 집계, 기준일 각주, stat 코드북, 랭킹 계산)를
검증한다 -- UI 프레임워크와 무관하게 지켜져야 하는 계약이다.
"""

from __future__ import annotations

import pandas as pd
import pytest

import display
from conftest import ROOT


class TestMapPerformance:
    def test_grid_aggregate_shrinks_payload(self) -> None:
        # 같은 격자에 들어가는 좌표 3개 + 떨어진 좌표 1개
        pts = pd.DataFrame({
            "lat": [37.5001, 37.5002, 37.5003, 35.1],
            "lng": [127.0001, 127.0002, 127.0003, 129.0],
        })
        cells = display.grid_aggregate(pts)

        assert len(cells) == 2
        assert cells["count"].sum() == 4  # 아무 포인트도 잃지 않는다


class TestBasisFootnote:
    def test_basis_footnote_names_all_three_reference_dates(self) -> None:
        """세 데이터의 기준일이 다르다. 그걸 숨기면 사용자가 지표를 오독한다."""
        note = display.basis_footnote("20260712", "2025-12-31", has_population=True)

        assert "기준시점" in note
        assert "2026-07-12" in note  # 충전기 스냅샷
        assert "2025-12-31" in note  # 전기차 등록
        assert "2026-06" in note  # 인구

    def test_basis_footnote_marks_population_absent(self) -> None:
        note = display.basis_footnote("20260712", "2025-12-31", has_population=False)
        assert "N/A" in note


# 활용가이드 v1.23 공통코드 3.2절(stat). 필드 설명의 0~5 가 아니라 이 표가 정본이다.
GUIDE_STAT_CODES = {"0", "1", "2", "3", "4", "5", "6", "9"}


class TestStatCodebook:
    """F-1 회귀 방지: 코드북에 없는 stat 값이 조용히 증발하면 안 된다.

    실데이터 기준으로만 검증하면 지금 0건인 코드(6 예약중)가 빠져도 테스트가
    공허하게 통과한다. 그래서 **공식 코드표**를 기준으로 본다.
    """

    def test_codebook_covers_every_code_in_the_guide(self) -> None:
        missing = GUIDE_STAT_CODES - set(display.STAT_LABELS)
        assert not missing, f"활용가이드 코드표에 있는데 코드북에 없는 stat: {sorted(missing)}"

    def test_codebook_covers_every_stat_in_real_data(self) -> None:
        path = ROOT / "data" / "processed" / "chargers_clean.parquet"
        if not path.exists():
            pytest.skip("정제 테이블이 아직 없습니다")

        actual = set(pd.read_parquet(path, columns=["stat"])["stat"].unique())
        missing = actual - set(display.STAT_LABELS)
        assert not missing, f"코드북에 없는 stat 값: {sorted(missing)}"

    def test_label_stat_never_drops_rows(self) -> None:
        stat = pd.Series(["2", "3", "9", "77"])  # 77 은 미래의 미정의 코드
        labeled = display.label_stat(stat)

        assert labeled.notna().all()
        assert labeled.value_counts().sum() == len(stat)  # 아무것도 빠지지 않는다
        assert "미정의(77)" in set(labeled)


class TestMetricDefinition:
    """M3/M5 정의가 데이터 파이프라인 한 곳에서만 나오는지(F-2)."""

    def test_national_kpi_matches_aggregate_region(self) -> None:
        """개요 KPI 와 랭킹 표가 같은 정의를 써야 한다."""
        import metrics  # noqa: PLC0415

        chargers = pd.DataFrame([
            {"statId": "A", "zcode": "11", "is_fast": True, "stat": "2"},
            {"statId": "A", "zcode": "11", "is_fast": False, "stat": "3"},
            {"statId": "B", "zcode": "11", "is_fast": True, "stat": "5"},
        ])
        national = metrics.aggregate_region(chargers.assign(_all="전국"), "_all").iloc[0]

        assert national["station_count"] == 2
        assert national["charger_count"] == 3
        assert national["M3_fast_ratio"] == pytest.approx(2 / 3)
        assert national["M5_availability"] == pytest.approx(1 / 2)  # 점검중(5)은 분모 제외


class TestPercentDisplayContract:
    """분수(0~1)를 퍼센트로 표시하려면 데이터 계층이 반드시 분수여야 100배가 한 번만 된다."""

    def test_metrics_emit_fractions_not_percentages(self) -> None:
        """표시 계층이 100배를 하므로 데이터 계층은 반드시 0~1 이어야 한다."""
        path = ROOT / "data" / "processed" / "metrics_sido.parquet"
        if not path.exists():
            pytest.skip("지표 테이블이 아직 없습니다")

        m = pd.read_parquet(path)
        for col in ["M3_fast_ratio", "M5_availability"]:
            assert m[col].max() <= 1.0, f"{col} 이 분수가 아니다 -- 표시에서 이중 스케일링된다"
            assert m[col].min() >= 0.0


class TestBuildRankingView:
    """랭킹 계산부. 이전엔 app.render_ranking 이 전역 `filtered` 를 암묵 참조해서
    단위 테스트가 원천 불가였다 -- 스모크 1회(기본 필터)가 유일한 검증이었다.
    이제 순수 함수라 필터/정렬/결측을 직접 확인한다.
    """

    def _base(self) -> pd.DataFrame:
        return pd.DataFrame({
            "zcode": ["11", "26", "50"],
            "지역": ["서울특별시", "부산광역시", "제주특별자치도"],
            "ev_count": [100_000, 50_000, 60_000],
        })

    def _chargers(self) -> pd.DataFrame:
        return pd.DataFrame(
            [{"statId": "A", "zcode": "11", "is_fast": True, "stat": "2"} for _ in range(200)]
            + [{"statId": "B", "zcode": "26", "is_fast": False, "stat": "2"} for _ in range(50)]
        )  # 제주(50)는 충전기 0기

    def _view(self, chargers: pd.DataFrame) -> pd.DataFrame:
        import metrics  # noqa: PLC0415

        agg = metrics.aggregate_region(chargers, "zcode")
        return display.build_ranking_view(
            self._base(), agg, "zcode",
            denominator="ev_count", per=1000, metric_label="M1",
        )

    def test_metric_is_hand_calculable(self) -> None:
        view = self._view(self._chargers()).set_index("zcode")

        assert view.loc["11", "M1"] == pytest.approx(200 / 100)  # 200기 / (100,000/1000)
        assert view.loc["26", "M1"] == pytest.approx(50 / 50)

    def test_sorted_worst_first(self) -> None:
        view = self._view(self._chargers())
        assert view.iloc[0]["zcode"] == "50"  # 충전기 0기 -> M1 = 0
        assert list(view["M1"]) == sorted(view["M1"])

    def test_regions_absent_from_chargers_become_zero_not_nan(self) -> None:
        """필터로 어떤 지역의 충전기가 0이 되어도 행이 사라지면 안 된다."""
        view = self._view(self._chargers()).set_index("zcode")

        assert view.loc["50", "charger_count"] == 0
        assert view.loc["50", "M3_fast_ratio"] == 0
        assert not pd.isna(view.loc["50", "M1"])

    def test_ratio_columns_reflect_the_filtered_population(self) -> None:
        """급속만 필터 -> 모든 지역의 급속 비율이 100%. F-2 회귀 방지의 핵심."""
        chargers = self._chargers()
        fast_only = chargers[chargers["is_fast"]]

        view = self._view(fast_only)
        present = view[view["charger_count"] > 0]

        assert (present["M3_fast_ratio"] == 1.0).all()
        assert set(present["zcode"]) == {"11"}  # 부산은 완속뿐이라 0기

    def test_metrics_stay_fractions(self) -> None:
        """표시 계층이 percent 프리셋으로 100배 하므로 데이터는 0~1 이어야 한다."""
        view = self._view(self._chargers())
        assert view["M3_fast_ratio"].between(0, 1).all()
