"""정제 로직 단위 테스트.

여기서 잡는 것들은 전부 '에러 없이 조용히 틀리는' 종류다:
  - delYn='Y' 미필터 -> 충전기 과대집계
  - 문자열 "null" 미정규화 -> 결측이 결측으로 안 잡힘
  - 좌표 범위 미검증 -> 지도에 엉뚱한 점
"""

from __future__ import annotations

import pandas as pd
import pytest

import clean


def make_df(**overrides) -> pd.DataFrame:
    base = {
        "statId": ["A", "B", "C"],
        "chgerId": ["01", "01", "02"],
        "chgerType": ["04", "02", "04"],
        "addr": ["서울특별시 종로구 세종대로 1"] * 3,
        "addrDetail": ["지상", "null", ""],
        "location": ["null", "입구", "null"],
        "lat": ["37.5", "37.6", "37.7"],
        "lng": ["127.0", "127.1", "127.2"],
        "output": ["50", "7", "100"],
        "zscode": ["11110", "11110", "11110"],
        "delYn": ["N", "N", "N"],
        "stat": ["2", "3", "2"],
        "note": ["", "", ""],
        "method": ["단독", "단독", "단독"],
    }
    base.update(overrides)
    return pd.DataFrame(base)


class TestDropDeleted:
    """이 파이프라인에서 가장 위험한 필터다. 빠지면 에러 없이 충전기가 과대집계된다.

    프로덕션 함수를 **직접 호출해서** 검증한다. 테스트가 필터를 다시 구현하면
    프로덕션 코드를 지워도 테스트가 초록이라 아무것도 지키지 못한다.
    """

    def test_deleted_rows_are_dropped(self) -> None:
        kept, removed = clean.drop_deleted(make_df(delYn=["N", "Y", "N"]))

        assert len(kept) == 2
        assert removed == 1
        assert "B" not in kept["statId"].values

    def test_no_deleted_rows_survive(self) -> None:
        kept, removed = clean.drop_deleted(make_df(delYn=["Y", "Y", "N"]))

        assert (kept["delYn"] == "Y").sum() == 0
        assert removed == 2

    def test_keeps_everything_when_nothing_deleted(self) -> None:
        kept, removed = clean.drop_deleted(make_df())

        assert len(kept) == 3
        assert removed == 0

    def test_does_not_mutate_the_caller_frame(self) -> None:
        df = make_df(delYn=["N", "Y", "N"])
        clean.drop_deleted(df)
        assert len(df) == 3  # 원본은 그대로


class TestNormalizeNulls:
    def test_null_string_becomes_na(self) -> None:
        out = clean.normalize_nulls(make_df())
        assert pd.isna(out.loc[1, "addrDetail"])  # "null"
        assert pd.isna(out.loc[2, "addrDetail"])  # ""
        assert out.loc[0, "addrDetail"] == "지상"

    def test_location_null_normalized(self) -> None:
        out = clean.normalize_nulls(make_df())
        assert out["location"].isna().sum() == 2
        assert out.loc[1, "location"] == "입구"


class TestCoordValidation:
    def test_valid_korean_coords_pass(self) -> None:
        out = clean.add_coord_valid(make_df())
        assert out["coord_valid"].all()

    def test_out_of_range_coords_flagged(self) -> None:
        # 0,0 (결측 대용) / 일본 근처 경도 / 정상
        df = make_df(lat=["0", "37.5", "37.5"], lng=["0", "140.0", "127.0"])
        out = clean.add_coord_valid(df)
        assert list(out["coord_valid"]) == [False, False, True]

    def test_non_numeric_coords_flagged_invalid(self) -> None:
        df = make_df(lat=["abc", "37.5", "37.5"], lng=["127.0", "127.0", "127.0"])
        out = clean.add_coord_valid(df)
        assert not out.loc[0, "coord_valid"]

    def test_boundaries(self) -> None:
        df = make_df(
            lat=[str(clean.LAT_MIN), str(clean.LAT_MAX), "32.9"],
            lng=[str(clean.LNG_MIN), str(clean.LNG_MAX), "127.0"],
        )
        out = clean.add_coord_valid(df)
        assert list(out["coord_valid"]) == [True, True, False]


class TestIsFast:
    def test_output_50kw_is_fast(self) -> None:
        out = clean.add_is_fast(clean.normalize_nulls(make_df()))
        assert list(out["is_fast"]) == [True, False, True]  # 50, 7, 100

    def test_falls_back_to_chger_type_when_output_missing(self) -> None:
        # output 결측 -> chgerType 폴백. 02=AC완속, 08=DC콤보(완속), 04=DC콤보(급속)
        df = make_df(output=["null", "null", "null"], chgerType=["02", "08", "04"])
        out = clean.add_is_fast(clean.normalize_nulls(df))
        assert list(out["is_fast"]) == [False, False, True]


class TestCoordGate:
    def test_gate_threshold_is_98_percent(self) -> None:
        assert pytest.approx(0.98) == clean.COORD_GATE


class TestBackfillZscode:
    """zscode 는 API 명세상 옵션 항목(항목구분 0)이라 결측될 수 있다.

    현재 실측 결측률은 0% 라 이 경로는 실행되지 않지만, 결측이 생기는 날
    검증된 적 없는 코드가 돌면 안 되므로 여기서 동작을 고정한다.
    """

    def test_recovers_zscode_from_address(self) -> None:
        df = make_df(zscode=[pd.NA, pd.NA, "11110"])
        df["addr"] = [
            "서울특별시 종로구 세종대로 1",
            "부산광역시 해운대구 우동 1",
            "서울특별시 종로구 세종대로 1",
        ]
        out = clean.backfill_zscode(df)

        assert out.loc[0, "zscode"] == "11110"  # 종로구
        assert out.loc[1, "zscode"] == "26350"  # 해운대구
        assert out.loc[2, "zscode"] == "11110"  # 원래 있던 값은 그대로

    def test_leaves_na_when_address_unparseable(self) -> None:
        df = make_df(zscode=[pd.NA, "11110", "11110"])
        df["addr"] = ["알 수 없는 주소", "서울특별시 종로구 1", "서울특별시 종로구 1"]
        out = clean.backfill_zscode(df)

        assert pd.isna(out.loc[0, "zscode"])  # 억지로 채우지 않는다

    def test_noop_when_nothing_missing(self) -> None:
        df = make_df()
        before = df["zscode"].tolist()
        assert clean.backfill_zscode(df)["zscode"].tolist() == before
