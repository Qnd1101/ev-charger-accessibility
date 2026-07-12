"""주민등록 인구 시도별 조각 CSV -> 시군구 단일 파일 병합.

jumin.mois.go.kr 은 행정구역을 시군구까지 펼치면 **한 번에 한 시도씩만** 내려준다.
그래서 17개 조각 파일을 받아 하나로 합친다. 조각은 `data/raw/jumin_parts/` 에 둔다.

병합하면서 세 가지를 걸러낸다. 전부 조용히 M2 를 오염시키는 것들이다:

  - **일반구 행 (39개).** "경기도 수원시 장안구 (4111100000)" 처럼 시군구 아래 레벨이
    같이 내려온다. 충전소 API 의 zscode 체계(`zscode_map.csv`, 230개)에는 없는 코드다.
    그대로 두면 수원시 인구가 시(市) 행과 구(區) 행에 이중으로 잡힌다.

  - **세종 시군구 행.** 세종은 시도 행 "(3600000000)" 과 "(3611000000)" 이 둘 다 온다.
    `metrics.load_population()` 이 이미 시도 행을 zscode 36110 으로 보정하므로,
    시군구 행까지 남기면 36110 이 **두 행**이 되어 조인이 중복된다.

  - **전국 합계 행.** 조각 파일에는 없지만 방어적으로 제외한다.

출력 스키마와 인코딩(cp949)은 mois 원본과 같다. `metrics._read_jumin()` 이 그대로 읽는다.

usage:
    python scripts/build_jumin.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
REF_DIR = ROOT / "data" / "ref"
PARTS_DIR = RAW_DIR / "jumin_parts"
OUT_PATH = RAW_DIR / "jumin_sgg_202606.csv"

sys.path.insert(0, str(ROOT / "src"))
from regions import NATIONWIDE_CODE10, SEJONG_ZSCODE  # noqa: E402

SIDO_COUNT = 17

# 세종의 시군구 행. 시도 행과 중복이라 뺀다(모듈 독스트링).
SEJONG_SGG_CODE10 = SEJONG_ZSCODE + "00000"


def main() -> None:
    parts = sorted(PARTS_DIR.glob("*.csv"))
    if not parts:
        sys.exit(
            f"{PARTS_DIR.relative_to(ROOT)} 에 조각 CSV 가 없습니다.\n"
            "jumin.mois.go.kr -> 주민등록 인구 및 세대현황 -> 월간에서\n"
            "시도별로 '시군구까지 펼쳐서' 받아 이 디렉터리에 넣으세요."
        )

    frames = [pd.read_csv(p, encoding="cp949", dtype=str) for p in parts]
    df = pd.concat(frames, ignore_index=True)

    region_col = df.columns[0]
    df["code10"] = df[region_col].str.extract(r"\((\d{10})\)")[0]
    df = df.dropna(subset=["code10"]).drop_duplicates("code10")
    df = df[df["code10"] != NATIONWIDE_CODE10]

    is_sido = df["code10"].str.endswith("00000000")
    if is_sido.sum() != SIDO_COUNT:
        found = df.loc[is_sido, region_col].tolist()
        sys.exit(f"시도 {is_sido.sum()}개 != {SIDO_COUNT}개. 빠진 조각이 있습니다.\n{found}")

    ref = pd.read_csv(REF_DIR / "zscode_map.csv", dtype=str)
    valid_zscodes = set(ref["zscode"])

    sigungu = df[~is_sido].copy()
    sigungu["zscode"] = sigungu["code10"].str[:5]
    keep = sigungu["zscode"].isin(valid_zscodes) & (sigungu["code10"] != SEJONG_SGG_CODE10)

    dropped = sigungu[~keep]

    # 참조 맵에 없는 행을 조용히 버리면 안 된다. 버려도 되는 건 일반구("경기도 수원시 장안구")
    # 뿐이고, 이건 이름이 세 토큰이라는 점으로 구분된다. 주민등록이 인천 신규 구
    # ("인천광역시 제물포구", 두 토큰)처럼 **참조 맵보다 앞서 나가면** 그 행이 소리 없이
    # 사라져 중구/서구의 인구 분모가 결손된다. 그 순간 여기서 터져야 한다.
    unexpected = dropped[
        (dropped["code10"] != SEJONG_SGG_CODE10)
        & (dropped[region_col].str.split().str.len() < 3)
    ]
    if not unexpected.empty:
        sys.exit(
            "참조 맵(zscode_map.csv)에 없는 시군구가 인구 데이터에 있습니다. "
            "행정구역이 개편됐다면 참조 맵과 clean.py 브리지를 함께 갱신하세요.\n"
            + unexpected[region_col].to_string(index=False)
        )

    out = pd.concat([df[is_sido], sigungu[keep]]).sort_values("code10")

    missing = valid_zscodes - set(sigungu.loc[keep, "zscode"])
    if missing:
        names = ref[ref["zscode"].isin(missing)]
        print(f"경고: 인구가 없는 zscode {len(missing)}개")
        print(names.to_string(index=False))

    out[[region_col, *[c for c in df.columns if c not in (region_col, "code10")]]].to_csv(
        OUT_PATH, index=False, encoding="cp949"
    )

    print(f"{OUT_PATH.relative_to(ROOT)}: {len(out)} rows "
          f"(시도 {is_sido.sum()} + 시군구 {keep.sum()})")
    print(f"제외: 일반구·세종 중복 {len(dropped)}행")


if __name__ == "__main__":
    main()
