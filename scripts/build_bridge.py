"""지역코드 브리지 생성: 전남광주통합특별시(zcode 12) -> 레거시 광주(29)/전남(46).

2026년 API 응답에 신설 광역단체 '전남광주통합특별시'(zcode 12)가 등장했다.
기존 광주광역시(29) + 전라남도(46)의 27개 시군구가 12xxx 코드로 이관됐다.

문제는 참조 데이터가 둘 다 아직 분리 체계라는 것이다:
  - 한국전력공사 전기차 등록 (2025-12-31): 광주 / 전남 별도 컬럼
  - 행정안전부 주민등록 인구 (2026-06): 광주광역시 / 전라남도 별도 행

통합 코드를 그대로 쓰면 M1(EV 대비)과 M2(인구 대비) 조인이 모두 깨진다.
그래서 API 의 신규 코드를 레거시 체계로 되돌린다. 시군구명이 1:1로 대응하므로 무손실이다.

usage:
    python scripts/build_bridge.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
REF_DIR = ROOT / "data" / "ref"

sys.path.insert(0, str(ROOT / "src"))
from regions import LEGACY_ZCODES, MERGED_ZCODE  # noqa: E402


def main() -> None:
    snapshots = sorted(RAW_DIR.glob("chargers_*.parquet"))
    if not snapshots:
        sys.exit("스냅샷이 없습니다. 먼저 `python src/collect.py` 를 실행하세요.")

    df = pd.read_parquet(snapshots[-1], columns=["zcode", "zscode", "addr"])
    merged = df[df["zcode"] == MERGED_ZCODE].copy()
    if merged.empty:
        print(f"zcode={MERGED_ZCODE} 행이 없습니다. 브리지가 필요 없습니다.")
        return

    # "전남광주통합특별시 순천시 ..." -> 두 번째 토큰이 시군구명
    merged["sigungu"] = merged["addr"].str.split().str[1]

    # 한 zscode 안에 오타성 시군구명이 소수 섞여 있다(예: 12300 에 광산구 12행).
    # zscode 별 최빈 시군구명을 정본으로 삼는다.
    canonical = (
        merged.groupby(["zscode", "sigungu"])
        .size()
        .reset_index(name="n")
        .sort_values("n", ascending=False)
        .drop_duplicates("zscode")[["zscode", "sigungu"]]
    )

    ref = pd.read_csv(REF_DIR / "zscode_map.csv", dtype=str)
    legacy = ref[ref["zcode"].isin(LEGACY_ZCODES)]

    bridge = canonical.merge(
        legacy.rename(
            columns={
                "zscode": "legacy_zscode",
                "zcode": "legacy_zcode",
                "sido": "legacy_sido",
            }
        ),
        on="sigungu",
        how="left",
    )

    unmatched = bridge[bridge["legacy_zscode"].isna()]["sigungu"].tolist()
    if unmatched:
        sys.exit(f"레거시 시군구에 매칭되지 않는 이름: {unmatched}")

    if len(bridge) != len(legacy):
        sys.exit(
            f"브리지 {len(bridge)}개 != 레거시 시군구 {len(legacy)}개. "
            "통합 지역 구성이 예상과 다릅니다."
        )

    bridge = bridge.rename(columns={"zscode": "new_zscode", "sigungu": "new_sigungu"})
    bridge = bridge[
        ["new_zscode", "new_sigungu", "legacy_zscode", "legacy_zcode", "legacy_sido"]
    ].sort_values("new_zscode")

    out = REF_DIR / "zscode_bridge.csv"
    bridge.to_csv(out, index=False, encoding="utf-8")

    print(f"{out.name}: {len(bridge)} rows")
    print(bridge.to_string(index=False))


if __name__ == "__main__":
    main()
