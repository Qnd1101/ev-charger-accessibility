"""지표 산출 테스트. 손계산 가능한 픽스처로 M1~M5 를 검증한다."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

import metrics


def sgg_pop(table: pd.DataFrame) -> metrics.Population:
    return metrics.Population(table, key="zscode", label="시군구")


def sido_pop(table: pd.DataFrame) -> metrics.Population:
    return metrics.Population(table, key="zcode", label="시도")


@pytest.fixture
def chargers() -> pd.DataFrame:
    """서울(11) 10기 / 부산(26) 4기. 손계산 가능한 크기.

    서울: 충전소 2곳(A 6기, B 4기), 급속 6기, stat 2=6 3=2 5=2
    부산: 충전소 1곳(C 4기), 급속 1기, stat 2=3 3=1
    """
    rows = []
    for i in range(6):
        rows.append({"statId": "A", "chgerId": f"{i:02d}", "zcode": "11", "zscode": "11110",
                     "is_fast": True, "stat": "2" if i < 4 else ("3" if i < 5 else "5")})
    for i in range(4):
        rows.append({"statId": "B", "chgerId": f"{i:02d}", "zcode": "11", "zscode": "11110",
                     "is_fast": False, "stat": "2" if i < 2 else ("3" if i < 3 else "5")})
    for i in range(4):
        rows.append({"statId": "C", "chgerId": f"{i:02d}", "zcode": "26", "zscode": "26110",
                     "is_fast": i == 0, "stat": "2" if i < 3 else "3"})
    return pd.DataFrame(rows)


@pytest.fixture
def ev_counts() -> pd.DataFrame:
    # 서울 5,000대 / 부산 2,000대
    return pd.DataFrame({
        "zcode": ["11", "26"],
        "sido_full": ["서울특별시", "부산광역시"],
        "ev_count": [5000, 2000],
        "ev_date": ["2025-12-31", "2025-12-31"],
    })


class TestAggregate:
    def test_charger_and_station_counts(self, chargers: pd.DataFrame) -> None:
        agg = metrics.aggregate_region(chargers, "zcode").set_index("zcode")
        assert agg.loc["11", "charger_count"] == 10
        assert agg.loc["11", "station_count"] == 2  # A, B
        assert agg.loc["26", "charger_count"] == 4
        assert agg.loc["26", "station_count"] == 1

    def test_m3_fast_ratio(self, chargers: pd.DataFrame) -> None:
        agg = metrics.aggregate_region(chargers, "zcode").set_index("zcode")
        assert agg.loc["11", "M3_fast_ratio"] == pytest.approx(6 / 10)
        assert agg.loc["26", "M3_fast_ratio"] == pytest.approx(1 / 4)

    def test_m4_chargers_per_station(self, chargers: pd.DataFrame) -> None:
        agg = metrics.aggregate_region(chargers, "zcode").set_index("zcode")
        assert agg.loc["11", "M4_chargers_per_station"] == pytest.approx(10 / 2)
        assert agg.loc["26", "M4_chargers_per_station"] == pytest.approx(4 / 1)

    def test_m5_availability_excludes_broken_chargers(self, chargers: pd.DataFrame) -> None:
        """분모는 stat in {2,3} 만. 점검중(5)은 제외 -- 아니면 가용률이 아니라 고장률이 된다.

        서울: 사용가능(2) 6기 [A 4 + B 2], 충전중(3) 3기 [A 1 + B 1]... 실제로는
              A: 2,2,2,2,3,5 / B: 2,2,3,5  -> stat2=6, stat3=2, stat5=2
              가용률 = 6 / (6+2) = 0.75
        """
        agg = metrics.aggregate_region(chargers, "zcode").set_index("zcode")
        assert agg.loc["11", "live_count"] == 8  # 10기 중 점검중 2기 제외
        assert agg.loc["11", "available_count"] == 6
        assert agg.loc["11", "M5_availability"] == pytest.approx(6 / 8)
        assert agg.loc["26", "M5_availability"] == pytest.approx(3 / 4)


class TestM1:
    def test_hand_calculated_m1(self, chargers, ev_counts, monkeypatch) -> None:
        """충전기 10기 / EV 5,000대 -> 10 / (5000/1000) = 2.0"""
        monkeypatch.setattr(metrics, "load_kepco_ev", lambda: ev_counts)
        sido = metrics.build_sido(chargers).set_index("zcode")

        assert sido.loc["11", "M1_chargers_per_1k_ev"] == pytest.approx(2.0)
        assert sido.loc["26", "M1_chargers_per_1k_ev"] == pytest.approx(4 / 2.0)  # 2.0

    def test_sorted_ascending_worst_first(self, chargers, ev_counts, monkeypatch) -> None:
        ev = ev_counts.copy()
        ev.loc[ev["zcode"] == "11", "ev_count"] = 20_000  # 서울을 부족하게
        monkeypatch.setattr(metrics, "load_kepco_ev", lambda: ev)

        sido = metrics.build_sido(chargers)
        assert sido.iloc[0]["zcode"] == "11"  # 최하위(가장 부족)가 첫 행

    def test_raises_when_ev_count_missing(self, chargers, monkeypatch) -> None:
        """시도 조인이 깨지면 조용히 넘어가지 말고 터져야 한다."""
        partial = pd.DataFrame({
            "zcode": ["11"], "sido_full": ["서울특별시"],
            "ev_count": [5000], "ev_date": ["2025-12-31"],
        })
        monkeypatch.setattr(metrics, "load_kepco_ev", lambda: partial)

        with pytest.raises(RuntimeError, match="ev_count 결측"):
            metrics.build_sido(chargers)


class TestM2:
    def test_hand_calculated_m2(self, chargers) -> None:
        """서울 종로구 10기 / 인구 100,000 -> 10 / (100000/100000) = 10.0"""
        population = sgg_pop(pd.DataFrame(
            {"zscode": ["11110", "26110"], "population": [100_000, 200_000]}))
        sgg = metrics.build_sgg(chargers, population).set_index("zscode")

        assert sgg.loc["11110", "M2_chargers_per_100k_pop"] == pytest.approx(10.0)
        assert sgg.loc["26110", "M2_chargers_per_100k_pop"] == pytest.approx(2.0)

    def test_raises_when_population_coverage_too_low(self, chargers) -> None:
        population = sgg_pop(pd.DataFrame({"zscode": ["11110"], "population": [100_000]}))
        with pytest.raises(RuntimeError, match="인구를 못 찾은 충전기"):
            metrics.build_sgg(chargers, population)


class TestGracefulDegradation:
    def test_returns_none_when_no_population_csv(self, monkeypatch, tmp_path) -> None:
        """인구 CSV 가 하나도 없어도 죽지 않는다 -- 접근성 지표만 건너뛴다."""
        monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", tmp_path / "no_sgg.csv")
        monkeypatch.setattr(metrics, "JUMIN_SIDO_PATH", tmp_path / "no_sido.csv")
        assert metrics.load_population() is None


class TestKepcoParsing:
    def test_loads_latest_row_and_maps_all_17_sidos(self) -> None:
        """cp949 인코딩 + 최신 기준일 + 17개 시도 매핑."""
        ev = metrics.load_kepco_ev()

        assert len(ev) == 17
        assert ev["ev_count"].isna().sum() == 0
        assert ev["ev_date"].iloc[0] == "2025-12-31"  # 파일의 마지막 기준일

        seoul = ev[ev["zcode"] == "11"]["ev_count"].iloc[0]
        assert seoul == 101_331  # 2025-12-31 서울 실제값


class TestJuminParsing:
    def test_strips_thousands_separator_and_national_total(self, tmp_path, monkeypatch) -> None:
        csv = tmp_path / "jumin.csv"
        csv.write_text(
            '"행정구역","2026년06월_총인구수"\n'
            '"전국  (1000000000)","51,091,769"\n'
            '"서울특별시  (1100000000)","9,289,813"\n'
            '"서울특별시 종로구  (1111000000)","140,000"\n'
            '"서울특별시 중구  (1114000000)","120,500"\n',
            encoding="cp949",
        )
        monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", csv)
        monkeypatch.setattr(metrics, "JUMIN_SIDO_PATH", csv.parent / "absent.csv")

        loaded = metrics.load_population()
        assert loaded.label == "시군구"
        pop = loaded.table

        # 전국 합계행과 시도 행은 빠지고 시군구 2개만 남는다
        assert len(pop) == 2
        assert set(pop["zscode"]) == {"11110", "11140"}
        assert pop.set_index("zscode").loc["11110", "population"] == 140_000  # 콤마 제거됨


class TestSejong:
    """세종은 시군구가 없는 유일한 광역단체다.

    주민등록에는 시도 행 '세종특별자치시 (3600000000)' 하나로만 나오는데
    충전소 API 는 세종 충전기에 zscode=36110 을 준다. 시도 행이라고 버리면
    세종 충전기 6,474기가 M2 에서 NaN 이 되어 접근성 랭킹에서 통째로 사라진다.
    """

    def _jumin(self, tmp_path) -> Path:
        csv = tmp_path / "jumin.csv"
        csv.write_text(
            '"행정구역","2026년06월_총인구수"\n'
            '"전국  (1000000000)","51,091,769"\n'
            '"서울특별시  (1100000000)","9,289,813"\n'
            '"서울특별시 종로구  (1111000000)","140,000"\n'
            '"세종특별자치시  (3600000000)","390,923"\n',
            encoding="cp949",
        )
        return csv

    def test_sejong_gets_a_zscode(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", self._jumin(tmp_path))
        pop = metrics.load_population().table.set_index("zscode")

        assert "36110" in pop.index, "세종이 인구 데이터에서 빠졌다 -- M2 에서 사라진다"
        assert pop.loc["36110", "population"] == 390_923

    def test_other_sido_rows_are_still_dropped(self, tmp_path, monkeypatch) -> None:
        """세종만 예외다. 서울 시도 행(1100000000)까지 들어오면 이중집계된다."""
        monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", self._jumin(tmp_path))
        pop = metrics.load_population().table

        assert "11000" not in pop["zscode"].values
        assert set(pop["zscode"]) == {"11110", "36110"}

    def test_sejong_chargers_get_an_m2_value(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", self._jumin(tmp_path))
        population = metrics.load_population()

        chargers = pd.DataFrame([
            {"statId": "S1", "zcode": "36", "zscode": "36110", "is_fast": True, "stat": "2"},
            {"statId": "S1", "zcode": "36", "zscode": "36110", "is_fast": False, "stat": "2"},
        ])
        sgg = metrics.build_sgg(chargers, population).set_index("zscode")

        # 2기 / 인구 390,923 -> 2 / 3.90923 = 0.5116
        assert sgg.loc["36110", "M2_chargers_per_100k_pop"] == pytest.approx(2 / 3.90923, rel=1e-4)


class TestPopulationGateIsChargerWeighted:
    """결측률을 시군구 행 수로 재면, 충전기가 몰린 지역 하나가 통째로 빠져도
    '1/230 = 0.4%' 로 보여 게이트를 그냥 통과한다. 충전기 수로 가중해야 한다."""

    def test_gate_fires_when_many_chargers_lose_population(self) -> None:
        # 시군구 2곳 중 1곳(행 기준 50%)이 아니라, 충전기 기준 90% 가 인구를 잃는 상황
        chargers = pd.DataFrame(
            [{"statId": f"A{i}", "zcode": "11", "zscode": "11110", "is_fast": True, "stat": "2"}
             for i in range(90)]
            + [{"statId": "B", "zcode": "26", "zscode": "26110", "is_fast": True, "stat": "2"}
               for _ in range(10)]
        )
        population = sgg_pop(pd.DataFrame({"zscode": ["26110"], "population": [50_000]}))

        with pytest.raises(RuntimeError, match="인구를 못 찾은 충전기"):
            metrics.build_sgg(chargers, population)


class TestSidoPopulationFallback:
    """시군구 인구 파일이 없으면 접근성 지표를 포기하지 않고 시도 해상도로 낸다.

    보유한 주민등록 파일이 시도 17행짜리일 때 원래는 M2 를 통째로 버렸는데,
    같은 지표를 낮은 해상도로는 낼 수 있다. 해상도를 잃는 것과 지표를 잃는 것은 다르다.
    """

    def _sido_csv(self, tmp_path) -> Path:
        csv = tmp_path / "jumin_sido.csv"
        csv.write_text(
            '"행정구역","2026년06월_총인구수"\n'
            '"전국  (1000000000)","51,091,769"\n'
            '"서울특별시  (1100000000)","9,289,813"\n'
            '"부산광역시  (2600000000)","3,232,370"\n',
            encoding="cp949",
        )
        return csv

    def test_uses_sido_file_when_sgg_absent(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", tmp_path / "absent.csv")
        monkeypatch.setattr(metrics, "JUMIN_SIDO_PATH", self._sido_csv(tmp_path))

        loaded = metrics.load_population()
        pop = loaded.table

        assert loaded.label == "시도"
        assert set(pop["zcode"]) == {"11", "26"}  # 전국 합계행 제외
        assert pop.set_index("zcode").loc["11", "population"] == 9_289_813

    def test_sgg_file_wins_when_both_exist(self, tmp_path, monkeypatch) -> None:
        """고해상도가 있으면 그쪽을 쓴다."""
        sgg = tmp_path / "sgg.csv"
        sgg.write_text(
            '"행정구역","2026년06월_총인구수"\n'
            '"서울특별시 종로구  (1111000000)","140,000"\n',
            encoding="cp949",
        )
        monkeypatch.setattr(metrics, "JUMIN_SGG_PATH", sgg)
        monkeypatch.setattr(metrics, "JUMIN_SIDO_PATH", self._sido_csv(tmp_path))

        assert metrics.load_population().label == "시군구"

    def test_sido_m2_hand_calculated(self, chargers, ev_counts, monkeypatch) -> None:
        """서울 10기 / 인구 100,000 -> 10 / 1.0 = 10.0"""
        monkeypatch.setattr(metrics, "load_kepco_ev", lambda: ev_counts)
        population = sido_pop(pd.DataFrame({"zcode": ["11", "26"], "population": [100_000, 50_000]}))

        sido = metrics.build_sido(chargers, population).set_index("zcode")

        assert sido.loc["11", "M2_chargers_per_100k_pop"] == pytest.approx(10.0)
        assert sido.loc["26", "M2_chargers_per_100k_pop"] == pytest.approx(4 / 0.5)  # 8.0

    def test_sido_m1_still_works_without_population(self, chargers, ev_counts, monkeypatch) -> None:
        """인구가 없어도 M1 은 그대로 나온다."""
        monkeypatch.setattr(metrics, "load_kepco_ev", lambda: ev_counts)
        sido = metrics.build_sido(chargers, population=None)

        assert "M1_chargers_per_1k_ev" in sido.columns
        assert "M2_chargers_per_100k_pop" not in sido.columns


class TestRealSidoPopulationFile:
    def test_actual_file_covers_all_17_sido(self) -> None:
        """이관한 실제 파일(jumin_sido_202606.csv)로 17개 시도가 전부 매칭돼야 한다."""
        if not metrics.JUMIN_SIDO_PATH.exists():
            pytest.skip("시도 인구 파일이 없습니다")

        loaded = metrics.load_population()
        pop = loaded.table
        if loaded.is_sigungu:
            pytest.skip("시군구 파일이 있어 시도 폴백을 타지 않습니다")

        ev = metrics.load_kepco_ev()
        assert set(pop["zcode"]) == set(ev["zcode"]), "인구와 EV 의 시도 집합이 다르다"
        assert len(pop) == 17


class TestKepcoThousandsSeparator:
    """공공데이터는 개정될 때 천단위 구분자가 붙는 일이 흔하다.

    현재 파일은 콤마가 없어 thousands="," 없이도 우연히 통과했다.
    콤마가 붙는 순간 to_numeric 이 NaN 을 만들고 시도 조인이 깨진다.
    """

    def test_parses_ev_counts_with_commas(self, tmp_path, monkeypatch) -> None:
        csv = tmp_path / "kepco.csv"
        csv.write_text(
            "기준일,서울,인천,경기,강원,충북,충남,대전,세종,경북,대구,전북,전남,광주,경남,부산,울산,제주\n"
            '2025-12-31,"101,331","79,860","207,075","25,679","32,901","39,839","25,432","7,330",'
            '"45,090","42,592","30,511","41,322","19,115","65,934","60,687","13,340","61,063"\n',
            encoding="cp949",
        )
        monkeypatch.setattr(metrics, "KEPCO_PATH", csv)

        ev = metrics.load_kepco_ev()

        assert len(ev) == 17
        assert ev["ev_count"].isna().sum() == 0, "콤마 때문에 NaN 이 생겼다"
        assert ev.set_index("zcode").loc["11", "ev_count"] == 101_331
        assert ev["ev_count"].dtype.kind in "iu", "정수로 파싱돼야 한다"
