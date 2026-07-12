"""대시보드 정적 검증.

streamlit 앱을 렌더하지 않고도 지킬 수 있는 두 가지 제약을 코드에서 직접 확인한다:
  - API 를 호출하지 않는다 (Parquet 만 읽는다)
  - 52만 포인트를 folium 개별 마커로 찍지 않는다 (브라우저가 멈춘다)
"""

from __future__ import annotations

import ast

import pandas as pd
import pytest

import display
from conftest import ROOT

APP_PATH = ROOT / "src" / "app.py"


def imported_modules() -> set[str]:
    tree = ast.parse(APP_PATH.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module.split(".")[0])
    return names


class TestNoApiCalls:
    def test_does_not_import_requests(self) -> None:
        """대시보드는 스냅샷만 읽는다. API 호출 0회."""
        assert "requests" not in imported_modules()

    def test_does_not_import_collect(self) -> None:
        assert "collect" not in imported_modules()


class TestMapPerformance:
    def test_does_not_use_folium(self) -> None:
        """folium 개별 마커로 52만 포인트를 렌더하면 브라우저가 프리즈한다."""
        assert "folium" not in imported_modules()

    def test_uses_pydeck(self) -> None:
        assert "pydeck" in imported_modules()

    def test_uses_aggregation_layer(self) -> None:
        source = APP_PATH.read_text(encoding="utf-8")
        assert "ColumnLayer" in source or "HeatmapLayer" in source
        assert "ScatterplotLayer" not in source  # 개별 점 렌더 금지

    def test_grid_aggregates_before_sending_to_browser(self) -> None:
        """52만 포인트를 그대로 pydeck 에 넘기면 브라우저로 가는 JSON 이 40MB 가 된다.

        folium 마커를 피한 이유와 같은 문제라서, 서버에서 격자 집계한 뒤 넘겨야 한다.
        """
        source = APP_PATH.read_text(encoding="utf-8")
        assert "grid_aggregate" in source
        assert "data=cells" in source  # 원본 프레임이 아니라 집계 결과를 넘긴다

    def test_grid_aggregate_shrinks_payload(self) -> None:
        # 같은 격자에 들어가는 좌표 3개 + 떨어진 좌표 1개
        pts = pd.DataFrame({
            "lat": [37.5001, 37.5002, 37.5003, 35.1],
            "lng": [127.0001, 127.0002, 127.0003, 129.0],
        })
        cells = display.grid_aggregate(pts)

        assert len(cells) == 2
        assert cells["count"].sum() == 4  # 아무 포인트도 잃지 않는다


class TestRequiredUiElements:
    def test_has_four_tabs(self) -> None:
        source = APP_PATH.read_text(encoding="utf-8")
        for tab in ["개요", "분포 지도", "부족 지역 랭킹", "접근성 랭킹"]:
            assert tab in source

    def test_has_unit_badges(self) -> None:
        source = APP_PATH.read_text(encoding="utf-8")
        assert "unit_badge" in source
        assert "시도" in source and "시군구" in source

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

    def test_app_renders_the_footnote(self) -> None:
        assert "basis_footnote" in APP_PATH.read_text(encoding="utf-8")

    def test_has_all_four_filters(self) -> None:
        source = APP_PATH.read_text(encoding="utf-8")
        assert "picked_sido" in source
        assert "speed" in source
        assert "picked_op" in source
        assert "only_24h" in source

    def test_accessibility_tab_falls_back_to_sido_resolution(self) -> None:
        """시군구 인구가 없으면 접근성 탭이 꺼지는 게 아니라 시도 해상도로 내려간다.

        인구 파일이 아예 없을 때만 안내를 띄운다.
        """
        source = APP_PATH.read_text(encoding="utf-8")
        assert "sgg_metrics is not None" in source
        assert '"population" in sido_metrics.columns' in source  # 시도 폴백
        assert "jumin.mois.go.kr" in source  # 둘 다 없을 때 안내


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


class TestNoDuplicatedMetricDefinition:
    """M3/M5 를 app 이 따로 정의하면 정의가 두 벌이 된다(F-2).

    이전 버전은 `M3_fast_ratio"] =` 문자열만 봤는데, 개요 탭이
    `filtered["stat"].isin(["2","3"])` 형태로 리터럴 재구현을 하고 있어도 통과했다.
    이제 **stat 코드 리터럴 자체**가 app 에 없는지 본다.
    """

    def test_app_imports_aggregate_region(self) -> None:
        assert "metrics" in imported_modules()

    def test_app_only_touches_the_stat_column_to_label_it(self) -> None:
        """모집단 재정의(가용률 분모 등)는 반드시 stat 컬럼을 만져야 한다.

        그래서 `filtered["stat"]` 의 **사용처 자체**를 단언한다. 리터럴 형태를 검사하면
        list -> tuple 로 바꾸는 것만으로 우회된다 (실제로 그렇게 우회됐다).
        허용되는 유일한 사용처는 display.label_stat() 의 인자다.
        """
        tree = ast.parse(APP_PATH.read_text(encoding="utf-8"))

        def is_stat_column(node: ast.AST) -> bool:
            return (
                isinstance(node, ast.Subscript)
                and isinstance(node.slice, ast.Constant)
                and node.slice.value == "stat"
            )

        allowed = {
            id(arg)
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "label_stat"
            for arg in node.args
        }
        offenders = [n for n in ast.walk(tree) if is_stat_column(n) and id(n) not in allowed]

        assert not offenders, (
            "app 이 stat 컬럼을 label_stat 밖에서 만진다 -- 지표 정의가 두 벌이 된다. "
            "aggregate_region 을 재사용하라."
        )

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
    """분수(0~1)를 printf '%%' 포맷으로 표시하면 100배가 안 돼 26.4%가 '0.3%'로 찍힌다.

    Streamlit 의 printf 는 sprintf-js 라 '%%' 는 리터럴 퍼센트 기호일 뿐이다.
    스케일링을 하는 건 'percent' 프리셋뿐이다. 데이터 계층은 분수로 통일하고
    표시 계층만 퍼센트를 담당해야 두 스케일이 공존하지 않는다.
    """

    def test_ratio_columns_use_percent_preset_not_printf(self) -> None:
        source = APP_PATH.read_text(encoding="utf-8")
        assert 'format="%.1f%%"' not in source, (
            "printf '%%' 는 100배를 하지 않는다 -- format=\"percent\" 를 써야 한다"
        )

    def test_every_ratio_column_uses_the_percent_preset(self) -> None:
        """비율 컬럼(급속 비율/가용률)에 붙은 format 은 전부 'percent' 여야 한다."""
        source = APP_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)

        ratio_labels = {"급속 비율", "가용률"}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            for k, v in zip(node.keys, node.values):
                if not (isinstance(k, ast.Constant) and k.value in ratio_labels):
                    continue
                if not isinstance(v, ast.Call):  # NumberColumn(...) 이 아니면 라벨 맵이다
                    continue
                fmt = next(
                    (kw.value.value for kw in v.keywords
                     if kw.arg == "format" and isinstance(kw.value, ast.Constant)),
                    None,
                )
                assert fmt == "percent", f"{k.value} 의 format 이 'percent' 가 아니다: {fmt!r}"

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
