"""수집 스냅샷 정제 + 좌표 품질 게이트.

usage:
    python src/clean.py                       # 최신 스냅샷 사용
    python src/clean.py --snapshot <path>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

from regions import (
    INCHEON_LEGACY_ZSCODE,
    LAT_MAX,
    LAT_MIN,
    LNG_MAX,
    LNG_MIN,
    MERGED_ZCODE,
)

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
REF_DIR = ROOT / "data" / "ref"

COORD_GATE = 0.98  # 이 아래면 보조 위경도 데이터 도입을 재검토해야 한다
ZSCODE_GATE = 0.02  # zscode 결측률 상한. 넘으면 M2 에서 그만큼이 조용히 증발한다

# 완속 충전기 타입. output(kW)이 결측일 때만 쓰는 폴백.
SLOW_CHGER_TYPES = {"02", "08"}
FAST_KW = 50.0

NULLABLE_COLS = ["addrDetail", "location", "output", "zscode", "note", "method"]


def latest_snapshot() -> Path:
    snapshots = sorted(RAW_DIR.glob("chargers_*.parquet"))
    if not snapshots:
        sys.exit("스냅샷이 없습니다. 먼저 `python src/collect.py` 를 실행하세요.")
    return snapshots[-1]


def drop_deleted(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """API 는 "최근 삭제된 충전기 정보"도 응답에 섞어 보낸다(활용가이드 delYn 항목).

    필터하지 않으면 에러 없이 조용히 과대집계된다. 이 파이프라인에서 가장 위험한
    한 줄이라 clean() 본문에 인라인하지 않고 테스트 가능한 함수로 둔다.
    """
    kept = df[df["delYn"] != "Y"].copy()
    return kept, len(df) - len(kept)


def normalize_nulls(df: pd.DataFrame) -> pd.DataFrame:
    """API 가 결측을 문자열 "null" / "" 로 보낸다. 진짜 NA 로 바꾼다."""
    df = df.copy()
    for col in NULLABLE_COLS:
        if col in df.columns:
            df[col] = df[col].replace({"null": pd.NA, "": pd.NA, "NULL": pd.NA})
    return df


def add_coord_valid(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    df["lng"] = pd.to_numeric(df["lng"], errors="coerce")
    df["coord_valid"] = (
        df["lat"].between(LAT_MIN, LAT_MAX) & df["lng"].between(LNG_MIN, LNG_MAX)
    ).fillna(False)
    return df


def add_is_fast(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    output = pd.to_numeric(df["output"], errors="coerce")
    # output 과 chgerType 이 둘 다 결측이면 급속으로 단정하지 않는다.
    # 모를 때 급속(희소하고 가치 높은 쪽)으로 기울면 M3 급속비율이 낙관적으로 부풀려진다.
    by_type = df["chgerType"].notna() & ~df["chgerType"].isin(SLOW_CHGER_TYPES)
    df["output_kw"] = output
    df["is_fast"] = (output >= FAST_KW).where(output.notna(), by_type).astype(bool)
    return df


def canonicalize_region(df: pd.DataFrame) -> pd.DataFrame:
    """신설 전남광주통합특별시(zcode 12) 코드를 레거시 광주(29)/전남(46)으로 되돌린다.

    참조 데이터가 둘 다 아직 분리 체계라서 통합 코드로는 조인이 안 된다:
      - 한전 전기차 등록(2025-12-31): 광주 / 전남 별도
      - 주민등록 인구(2026-06):      광주광역시 / 전라남도 별도
    시군구가 1:1로 대응하므로 되돌려도 정보 손실은 없다.
    """
    bridge_path = REF_DIR / "zscode_bridge.csv"
    if not bridge_path.exists():
        return df

    bridge = pd.read_csv(bridge_path, dtype=str)

    # dict(zip(...)) 은 중복 키에서 마지막 값을 조용히 채택한다. 시군구명이 겹치면
    # (다른 통합 지역에 이 함수를 재사용할 때) 소리 없이 오매핑되므로 먼저 막는다.
    if not bridge["new_sigungu"].is_unique:
        dupes = bridge[bridge["new_sigungu"].duplicated()]["new_sigungu"].tolist()
        raise RuntimeError(f"브리지 시군구명 중복 -> 오매핑 위험: {dupes}")

    by_zscode = dict(zip(bridge["new_zscode"], bridge["legacy_zscode"]))
    # 같은 zscode 에 오타성 시군구명이 소수 섞여 있어(예: 12300 에 광산구) 이름을 먼저 본다.
    by_name = dict(zip(bridge["new_sigungu"], bridge["legacy_zscode"]))

    target = df["zcode"] == MERGED_ZCODE
    if not target.any():
        return df

    df = df.copy()
    sigungu = df.loc[target, "addr"].str.split().str[1]
    legacy = sigungu.map(by_name).fillna(df.loc[target, "zscode"].map(by_zscode))

    unmapped = int(legacy.isna().sum())
    if unmapped:
        raise RuntimeError(
            f"통합지역 코드 {unmapped:,}행을 레거시로 매핑하지 못했습니다. "
            "브리지가 최신 스냅샷과 어긋납니다 -- `python scripts/build_bridge.py` 를 다시 실행하세요."
        )

    df.loc[target, "zscode"] = legacy
    df.loc[target, "zcode"] = legacy.str[:2]
    print(f"통합지역 정규화: zcode=12 {int(target.sum()):,}행 -> 광주(29)/전남(46)")
    return df


def canonicalize_incheon(df: pd.DataFrame) -> pd.DataFrame:
    """2026년 개편된 인천 신규 구 코드를 개편 전 코드로 되돌린다.

    전남광주(canonicalize_region)와 같은 이유다. 참조 데이터가 아직 개편 전 체계라
    신규 코드로는 M1/M2 조인이 안 된다. 다만 전남광주와 달리 1:1 대응이 아니라
    재분할이라 이름으로 되돌릴 수 없어, regions.py 의 명시적 표를 쓴다.

    중구/동구는 경계 자체가 사라졌으므로 둘을 중구 하나로 합친다. 인구 분모도
    같이 합쳐야 한다 -- metrics.load_population 의 INCHEON_POP_MERGE 참조.
    """
    target = df["zscode"].isin(INCHEON_LEGACY_ZSCODE)
    if not target.any():
        return df

    df = df.copy()
    df.loc[target, "zscode"] = df.loc[target, "zscode"].map(INCHEON_LEGACY_ZSCODE)
    df.loc[target, "zcode"] = df.loc[target, "zscode"].str[:2]
    print(f"인천 개편 정규화: 신규 구 {int(target.sum()):,}행 -> 중구(28110)/서구(28260)")
    return df


def backfill_zscode(df: pd.DataFrame) -> pd.DataFrame:
    """zscode 는 옵션 항목이라 결측될 수 있다. 주소 앞부분으로 보정한다."""
    ref = pd.read_csv(REF_DIR / "zscode_map.csv", dtype=str)
    missing = df["zscode"].isna()
    if not missing.any():
        return df

    # "서울특별시 종로구 ..." 형태의 주소에서 시도+시군구 조합을 찾는다.
    lookup = {f"{r.sido} {r.sigungu}": r.zscode for r in ref.itertuples()}
    addr = df.loc[missing, "addr"].fillna("")
    resolved = addr.map(
        lambda a: next((z for k, z in lookup.items() if a.startswith(k)), pd.NA)
    )

    df = df.copy()
    df.loc[missing, "zscode"] = resolved
    return df


def clean(snapshot: Path) -> Path:
    df = pd.read_parquet(snapshot)
    print(f"원본: {len(df):,} 행  ({snapshot.name})")

    df, deleted = drop_deleted(df)
    print(f"delYn='Y' 제거: {deleted:,} 행 -> {len(df):,} 행")

    df = normalize_nulls(df)
    df = add_coord_valid(df)
    df = add_is_fast(df)
    df = canonicalize_region(df)
    df = canonicalize_incheon(df)
    df = backfill_zscode(df)

    valid_ratio = df["coord_valid"].mean()
    verdict = "PASS" if valid_ratio >= COORD_GATE else "FAIL"
    print(f"\n[좌표 품질 게이트] coord_valid={valid_ratio:.4%} (기준 {COORD_GATE:.0%}) -> {verdict}")
    if verdict == "FAIL":
        print("  게이트 미달: 한전 충전소 위경도 보조 데이터 도입을 재검토하세요.")

    # 좌표 게이트와 달리 여기는 경고만 하고 넘어가면 안 된다. zscode 가 빠지면
    # 시군구 지표(M2)에서 그만큼이 조용히 증발한다. 기준을 명시했으면 강제해야 한다.
    zscode_missing = df["zscode"].isna().mean()
    verdict_z = "PASS" if zscode_missing < ZSCODE_GATE else "FAIL"
    print(f"[zscode 결측률] {zscode_missing:.4%} (기준 <{ZSCODE_GATE:.0%}) -> {verdict_z}")
    if verdict_z == "FAIL":
        raise RuntimeError(
            f"zscode 결측률 {zscode_missing:.2%} 가 기준 {ZSCODE_GATE:.0%} 를 넘습니다. "
            "주소 파싱 보정(backfill_zscode)을 점검하세요."
        )

    print(f"[급속 비율] {df['is_fast'].mean():.2%}")

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / "chargers_clean.parquet"
    df.to_parquet(out_path, index=False)
    print(f"\n저장: {out_path}  ({len(df):,} 행)")
    return out_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", type=Path, default=None)
    args = ap.parse_args()
    clean(args.snapshot or latest_snapshot())


if __name__ == "__main__":
    main()
