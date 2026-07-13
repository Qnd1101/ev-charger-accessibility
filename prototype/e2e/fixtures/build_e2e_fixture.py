"""Playwright E2E 용 최소 합성 스냅샷 -> 실제 파이프라인 -> prototype/e2e/.output/data.

`tests/test_pipeline.py::synthetic_snapshot` 과 같은 패턴(합성 API 모양 parquet + monkeypatch)을
쓰되, pytest 밖에서 실행할 수 있는 독립 스크립트로 둔다(Playwright webServer 이전에 한 번 실행).

실제 파이프라인(clean.py -> metrics.py -> build_web_data.py)을 그대로 돌린다 -- 집계 로직을
스크립트가 재구현하면 "회귀 테스트가 실제로 파이프라인을 검증하는가"가 항진명제가 된다.
참조 데이터(zscode_map.csv, sido_name_map.csv, sigungu.topo.json)는 실제 커밋된 자산을
그대로 쓴다(합성해야 하는 건 충전기·인구·EV 원자료뿐).

지역 두 곳(서울 종로구, 부산 중구)을 실제 zscode 로 고른 이유: 손계산 가능한 M1/M2,
급속+완속이 섞인 충전소, 무효 좌표 1건, 운영기관 미진출 1건을 모두 담기 위해서다.
값의 유도는 이 파일의 docstring 이 아니라 prototype/e2e/tests 의 EXPECTED 상수에 있다
-- 테스트가 기대값의 단일 출처를 갖게 하기 위해서다.

usage:
    python prototype/e2e/fixtures/build_e2e_fixture.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import build_web_data  # noqa: E402
import clean  # noqa: E402
import metrics  # noqa: E402

OUT_ROOT = Path(__file__).resolve().parent.parent / ".output"
FIXTURE_RAW = OUT_ROOT / "fixture_raw"
FIXTURE_PROCESSED = OUT_ROOT / "fixture_processed"
# vite.e2e.config.ts 의 publicDir(e2e/.output/public) 밑이라야 프로덕션 빌드에 복사된다.
DATA_OUT = OUT_ROOT / "public" / "data"

API_COLUMNS = [
    "statNm", "statId", "chgerId", "chgerType", "addr", "addrDetail", "location",
    "useTime", "lat", "lng", "busiId", "bnm", "busiNm", "busiCall", "stat",
    "statUpdDt", "output", "method", "zcode", "zscode", "kind", "kindDetail",
    "parkingFree", "note", "limitYn", "delYn", "trafficYn", "year",
]

SNAPSHOT_DATE = "20260701"

# 한전 CSV 헤더가 요구하는 축약 시도명 -> zcode (scripts/build_ref.py 의 KEPCO_TO_ZCODE).
KEPCO_SIDO = {
    "서울": "11", "부산": "26", "대구": "27", "인천": "28", "광주": "29", "대전": "30",
    "울산": "31", "세종": "36", "경기": "41", "충북": "43", "충남": "44", "전남": "46",
    "경북": "47", "경남": "48", "제주": "50", "강원": "51", "전북": "52",
}
SEOUL_EV = 3000
BUSAN_EV = 1000
OTHER_EV = 500


def _row(**kw) -> dict:
    base = dict.fromkeys(API_COLUMNS, "")
    base.update({
        "chgerType": "04", "addrDetail": "null", "location": "null",
        "delYn": "N", "year": "2026",
    })
    base.update(kw)
    return base


def make_chargers() -> pd.DataFrame:
    """서울 종로구(11110) 3기 + 부산 중구(26110) 2기.

    - A1: 종로구, 환경부, 급속(01)+완속(02) 같은 충전소 -> 급속/완속 혼재 케이스.
    - A2: 종로구, 한국전력공사, 급속, 24시간, 사용가능 -> 운영기관 필터의 대조군.
    - B1: 중구, 환경부, 완속, 24시간, 사용가능, 좌표 정상.
    - B2: 중구, 환경부, 급속, 24시간, 사용가능, 좌표 무효(0,0) -> 무효 좌표 케이스.
      중구에는 한국전력공사가 없다 -> 한국전력공사로 필터하면 중구가 "미진출".
    """
    rows = [
        _row(statId="A1", chgerId="01", busiNm="환경부", output="100", stat="2",
             useTime="24시간 이용가능", addr="서울특별시 종로구 세종대로 1",
             lat="37.5730", lng="126.9794", zcode="11", zscode="11110"),
        _row(statId="A1", chgerId="02", busiNm="환경부", output="7", chgerType="02", stat="3",
             useTime="09:00~18:00 이용가능", addr="서울특별시 종로구 세종대로 1",
             lat="37.5730", lng="126.9794", zcode="11", zscode="11110"),
        _row(statId="A2", chgerId="01", busiNm="한국전력공사", output="50", stat="2",
             useTime="24시간 이용가능", addr="서울특별시 종로구 사직로 1",
             lat="37.5758", lng="126.9700", zcode="11", zscode="11110"),
        _row(statId="B1", chgerId="01", busiNm="환경부", output="7", chgerType="02", stat="2",
             useTime="24시간 이용가능", addr="부산광역시 중구 중앙대로 1",
             lat="35.1000", lng="129.0300", zcode="26", zscode="26110"),
        _row(statId="B2", chgerId="01", busiNm="환경부", output="100", stat="2",
             useTime="24시간 이용가능", addr="부산광역시 중구 중앙대로 2",
             lat="0", lng="0", zcode="26", zscode="26110"),
    ]
    return pd.DataFrame(rows).astype("string")


def make_kepco_csv(path: Path) -> None:
    header = "기준일," + ",".join(KEPCO_SIDO) + "\n"
    values = {"서울": SEOUL_EV, "부산": BUSAN_EV}
    row = "20251231," + ",".join(str(values.get(name, OTHER_EV)) for name in KEPCO_SIDO) + "\n"
    path.write_text(header + row, encoding="cp949")


def make_jumin_sgg_csv(path: Path) -> None:
    text = (
        '"행정구역","2026년06월_총인구수"\n'
        '"전국  (1000000000)","51,000,000"\n'
        '"서울특별시 종로구  (1111000000)","100,000"\n'
        '"부산광역시 중구  (2611000000)","50,000"\n'
    )
    path.write_text(text, encoding="cp949")


def main() -> None:
    for d in (FIXTURE_RAW, FIXTURE_PROCESSED, DATA_OUT):
        d.mkdir(parents=True, exist_ok=True)

    snapshot_path = FIXTURE_RAW / f"chargers_{SNAPSHOT_DATE}.parquet"
    make_chargers().to_parquet(snapshot_path, index=False)

    kepco_path = FIXTURE_RAW / "kepco_ev_synthetic.csv"
    make_kepco_csv(kepco_path)
    jumin_path = FIXTURE_RAW / "jumin_sgg_synthetic.csv"
    make_jumin_sgg_csv(jumin_path)

    with (
        mock.patch.object(clean, "RAW_DIR", FIXTURE_RAW),
        mock.patch.object(clean, "PROCESSED_DIR", FIXTURE_PROCESSED),
        mock.patch.object(metrics, "PROCESSED_DIR", FIXTURE_PROCESSED),
        mock.patch.object(metrics, "CLEAN_PATH", FIXTURE_PROCESSED / "chargers_clean.parquet"),
        mock.patch.object(metrics, "KEPCO_PATH", kepco_path),
        mock.patch.object(metrics, "JUMIN_SGG_PATH", jumin_path),
        mock.patch.object(metrics, "JUMIN_SIDO_PATH", FIXTURE_RAW / "does-not-exist.csv"),
    ):
        clean.clean(snapshot_path)
        metrics.main()

        with (
            mock.patch.object(build_web_data, "CLEAN_PATH", metrics.CLEAN_PATH),
            mock.patch.object(build_web_data, "PROCESSED_DIR", FIXTURE_PROCESSED),
            mock.patch.object(build_web_data, "OUT_DIR", DATA_OUT),
            mock.patch.object(
                build_web_data, "ROOT", ROOT,
            ),  # zscode_map.csv/경계 등 실제 참조 자산은 그대로 실 저장소 ROOT 에서 읽는다
        ):
            # build_web_data.main() 은 스냅샷 파일명에서 기준일을 유도하려 ROOT/data/raw 를
            # 다시 훑는다. 합성 스냅샷을 실제 저장소 data/raw 에 두면 AGENTS.md("data/raw 는
            # 커밋 대상 아님")와 실사용자 로컬 데이터를 침범한다. 대신 그 한 줄만 별도로
            # 감싼 얇은 진입점(_run)을 호출한다.
            _run_build_web_data(snapshot_path)

    print(f"\nE2E 픽스처 완료: {DATA_OUT}")


def _run_build_web_data(snapshot_path: Path) -> None:
    """build_web_data.main() 을 실행하되 스냅샷 기준일만 합성 파일명에서 유도한다."""
    real_glob = Path.glob

    def fake_glob(self: Path, pattern: str):  # noqa: ANN001
        if self == ROOT / "data" / "raw" and pattern == "chargers_*.parquet":
            return iter([snapshot_path])
        return real_glob(self, pattern)

    with mock.patch.object(Path, "glob", fake_glob):
        build_web_data.main()


if __name__ == "__main__":
    main()
