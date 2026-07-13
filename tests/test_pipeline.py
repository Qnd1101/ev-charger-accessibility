"""통합 테스트: 합성 스냅샷으로 clean -> metrics 전 구간을 실제로 돌린다.

단위 테스트는 함수를 하나씩 본다. 여기서는 API 응답과 같은 모양의 Parquet 을 만들어
파일 입출력까지 포함한 전체 경로를 태운다 -- 실제 수집 데이터가 오기 전에
런타임 오류를 잡기 위함이다.
"""

from __future__ import annotations

import pandas as pd
import pytest

import clean
import metrics

API_COLUMNS = [
    "statNm", "statId", "chgerId", "chgerType", "addr", "addrDetail", "location",
    "useTime", "lat", "lng", "busiId", "bnm", "busiNm", "busiCall", "stat",
    "statUpdDt", "output", "method", "zcode", "zscode", "kind", "kindDetail",
    "parkingFree", "note", "limitYn", "delYn", "trafficYn", "year",
]


def make_row(**kw) -> dict:
    base = dict.fromkeys(API_COLUMNS, "")
    base.update({
        "statNm": "테스트충전소", "statId": "AA000001", "chgerId": "01",
        "chgerType": "04", "addr": "서울특별시 종로구 세종대로 1",
        "addrDetail": "null", "location": "null", "useTime": "24시간 이용가능",
        "lat": "37.5700", "lng": "126.9800", "busiNm": "환경부",
        "stat": "2", "output": "50", "zcode": "11", "zscode": "11110",
        "delYn": "N", "year": "2024",
    })
    base.update(kw)
    return base


@pytest.fixture
def synthetic_snapshot(tmp_path, monkeypatch) -> pd.DataFrame:
    """서울 종로구 3기(1기는 삭제됨) + 부산 중구 2기(1기는 좌표 깨짐)."""
    rows = [
        make_row(statId="A1", chgerId="01", stat="2", output="100"),
        make_row(statId="A1", chgerId="02", stat="3", output="7", chgerType="02"),
        make_row(statId="A2", chgerId="01", stat="2", delYn="Y"),          # 삭제 -> 제외돼야 함
        make_row(statId="B1", chgerId="01", stat="2", zcode="26", zscode="26110",
                 addr="부산광역시 중구 중앙대로 1", lat="35.1000", lng="129.0300"),
        make_row(statId="B1", chgerId="02", stat="5", zcode="26", zscode="26110",
                 addr="부산광역시 중구 중앙대로 1", lat="0", lng="0"),      # 좌표 무효
    ]
    raw = tmp_path / "raw"
    processed = tmp_path / "processed"
    raw.mkdir()
    processed.mkdir()

    snapshot = raw / "chargers_20260712.parquet"
    pd.DataFrame(rows).astype("string").to_parquet(snapshot, index=False)

    monkeypatch.setattr(clean, "RAW_DIR", raw)
    monkeypatch.setattr(clean, "PROCESSED_DIR", processed)
    monkeypatch.setattr(metrics, "PROCESSED_DIR", processed)
    monkeypatch.setattr(metrics, "CLEAN_PATH", processed / "chargers_clean.parquet")
    monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", raw / "jumin_missing.csv")
    monkeypatch.setattr(metrics, "JUMIN_SIDO_PATH", raw / "jumin_missing2.csv")

    clean.clean(snapshot)
    return pd.read_parquet(processed / "chargers_clean.parquet")


class TestCleanEndToEnd:
    def test_deleted_charger_removed(self, synthetic_snapshot: pd.DataFrame) -> None:
        assert len(synthetic_snapshot) == 4  # 5기 중 delYn=Y 1기 제외
        assert (synthetic_snapshot["delYn"] == "Y").sum() == 0

    def test_null_strings_normalized(self, synthetic_snapshot: pd.DataFrame) -> None:
        assert synthetic_snapshot["addrDetail"].isna().all()
        assert synthetic_snapshot["location"].isna().all()

    def test_coord_valid_flags_broken_coordinate(self, synthetic_snapshot: pd.DataFrame) -> None:
        assert synthetic_snapshot["coord_valid"].sum() == 3  # 0,0 좌표 1기 제외
        assert not synthetic_snapshot.set_index("statId").loc["B1"]["coord_valid"].iloc[1]

    def test_is_fast_derived(self, synthetic_snapshot: pd.DataFrame) -> None:
        # output 100/50/50 = 급속 3기, chgerType 02(AC완속, output 7) = 완속 1기
        assert synthetic_snapshot["is_fast"].sum() == 3

    def test_invalid_coord_row_still_counted_in_aggregate(
        self, synthetic_snapshot: pd.DataFrame
    ) -> None:
        """좌표가 깨진 충전기는 지도에서만 빠지고 집계에는 남아야 한다."""
        busan = synthetic_snapshot[synthetic_snapshot["zcode"] == "26"]
        assert len(busan) == 2
        assert busan["coord_valid"].sum() == 1


class TestMetricsEndToEnd:
    def test_sido_metrics_written_and_joined(self, synthetic_snapshot, monkeypatch, capsys) -> None:
        ev = pd.DataFrame({
            "zcode": ["11", "26"], "sido_full": ["서울특별시", "부산광역시"],
            "ev_count": [2000, 1000], "ev_date": ["2025-12-31"] * 2,
        })
        monkeypatch.setattr(metrics, "load_kepco_ev", lambda: ev)

        metrics.main()

        sido = pd.read_parquet(metrics.PROCESSED_DIR / "metrics_sido.parquet").set_index("zcode")
        # 서울 2기 / EV 2000대 -> 2 / (2000/1000) = 1.0
        assert sido.loc["11", "charger_count"] == 2
        assert sido.loc["11", "M1_chargers_per_1k_ev"] == pytest.approx(1.0)
        # 부산 2기 / EV 1000대 -> 2 / 1.0 = 2.0
        assert sido.loc["26", "M1_chargers_per_1k_ev"] == pytest.approx(2.0)

    def test_m2_skipped_without_jumin_csv(self, synthetic_snapshot, monkeypatch, capsys) -> None:
        """인구 CSV 가 없어도 exit code 0 으로 끝나고 시도 지표는 나와야 한다."""
        ev = pd.DataFrame({
            "zcode": ["11", "26"], "sido_full": ["서울특별시", "부산광역시"],
            "ev_count": [2000, 1000], "ev_date": ["2025-12-31"] * 2,
        })
        monkeypatch.setattr(metrics, "load_kepco_ev", lambda: ev)

        metrics.main()  # SystemExit 를 던지지 않아야 한다

        out = capsys.readouterr().out
        assert "[M2 skip]" in out
        assert (metrics.PROCESSED_DIR / "metrics_sido.parquet").exists()
        assert not (metrics.PROCESSED_DIR / "metrics_sgg.parquet").exists()

    def test_m2_activates_when_jumin_csv_appears(
        self, synthetic_snapshot, monkeypatch, tmp_path
    ) -> None:
        """파일을 넣는 순간 M2 가 자동으로 켜져야 한다."""
        ev = pd.DataFrame({
            "zcode": ["11", "26"], "sido_full": ["서울특별시", "부산광역시"],
            "ev_count": [2000, 1000], "ev_date": ["2025-12-31"] * 2,
        })
        monkeypatch.setattr(metrics, "load_kepco_ev", lambda: ev)

        jumin = tmp_path / "raw" / "jumin_sgg_202606.csv"
        jumin.write_text(
            '"행정구역","2026년06월_총인구수"\n'
            '"전국  (1000000000)","51,091,769"\n'
            '"서울특별시 종로구  (1111000000)","100,000"\n'
            '"부산광역시 중구  (2611000000)","50,000"\n',
            encoding="cp949",
        )
        monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", jumin)

        metrics.main()

        sgg = pd.read_parquet(metrics.PROCESSED_DIR / "metrics_sgg.parquet").set_index("zscode")
        # 종로구 2기 / 인구 100,000 -> 2 / 1.0 = 2.0
        assert sgg.loc["11110", "M2_chargers_per_100k_pop"] == pytest.approx(2.0)
        # 부산 중구 2기 / 인구 50,000 -> 2 / 0.5 = 4.0
        assert sgg.loc["26110", "M2_chargers_per_100k_pop"] == pytest.approx(4.0)


class TestFilteredMetricsConsistency:
    """F-2 회귀 방지: 표의 모든 컬럼이 같은 모집단에서 나와야 한다.

    이전에는 charger_count/M1 만 필터를 반영하고 M3/M5 는 원본에서 실려나왔다.
    "급속만" 필터를 걸었는데 급속 비율이 26%로 표시되는 값을 사용자가 봤다.
    """

    def test_fast_only_filter_yields_100_percent_fast_ratio(
        self, synthetic_snapshot: pd.DataFrame
    ) -> None:
        fast_only = synthetic_snapshot[synthetic_snapshot["is_fast"]]
        agg = metrics.aggregate_region(fast_only, "zcode")

        assert (agg["M3_fast_ratio"] == 1.0).all(), (
            "급속만 필터인데 급속 비율이 100%가 아니다 -- 지표가 필터를 반영하지 않는다"
        )

    def test_slow_only_filter_yields_zero_fast_ratio(
        self, synthetic_snapshot: pd.DataFrame
    ) -> None:
        slow_only = synthetic_snapshot[~synthetic_snapshot["is_fast"]]
        agg = metrics.aggregate_region(slow_only, "zcode")
        assert (agg["M3_fast_ratio"] == 0.0).all()

    def test_filtered_aggregate_never_exceeds_unfiltered(
        self, synthetic_snapshot: pd.DataFrame
    ) -> None:
        full = metrics.aggregate_region(synthetic_snapshot, "zcode").set_index("zcode")
        subset = synthetic_snapshot[synthetic_snapshot["is_fast"]]
        part = metrics.aggregate_region(subset, "zcode").set_index("zcode")

        for zcode in part.index:
            assert part.loc[zcode, "charger_count"] <= full.loc[zcode, "charger_count"]
