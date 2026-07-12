"""지표 산출 파이프라인.

**공식 자체는 여기에 없다.** `metric_specs.METRICS` 가 유일한 원본이고, 이 모듈은 원자
카운트(충전기·충전소·급속·응답·사용가능)를 집계한 뒤 `apply_metrics` 로 파생 열을 붙인다.
같은 표를 `scripts/build_web_data.py` 가 JSON 으로 내보내 화면이 읽는다 -- 그래서 Python
과 UI 에 공식이 두 벌 존재할 수 없다.

M2 는 주민등록 시군구 CSV 가 있을 때만 산출된다. 없으면 경고 후 skip -- 나머지는 정상 산출한다.

usage:
    python src/metrics.py
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from metric_specs import apply_metrics
from regions import (
    INCHEON_POP_MERGE,
    NATIONWIDE_CODE10,
    SEJONG_CODE10,
    SEJONG_ZSCODE,
)

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
REF_DIR = ROOT / "data" / "ref"
PROCESSED_DIR = ROOT / "data" / "processed"

CLEAN_PATH = PROCESSED_DIR / "chargers_clean.parquet"
KEPCO_PATH = RAW_DIR / "kepco_ev_20251231.csv"

# 주민등록 인구는 시군구 파일이 있으면 그걸, 없으면 시도 파일을 쓴다.
# 같은 지표(인구 10만명당 충전기)를 낼 수 있는 해상도가 다를 뿐이다.
JUMIN_SGG_PATH = RAW_DIR / "jumin_sgg_202606.csv"
JUMIN_SIDO_PATH = RAW_DIR / "jumin_sido_202606.csv"

# M5 분모는 stat in {2 사용가능, 3 충전중} 만. 즉 M5 는 엄밀히는 "가용률"이 아니라
# **응답하는 충전기 중 지금 비어 있는 비율(유휴율)** 이다.
#   - 1(통신이상)/9(상태미확인) 제외: 상태를 모르는 것이지 불가용이라 단정할 수 없다.
#   - 4(운영중지)/5(점검중) 제외: 운전자 관점에선 명백히 불가용이므로 이건 선택의 문제다.
#     실측 0.44% 라 영향은 작지만, 값을 "가용률"로 읽으면 낙관 편향이 생긴다.
#     UI 툴팁이 이 제외 사실을 명시한다.
STAT_AVAILABLE = "2"
STAT_IN_USE = "3"

# 인구를 못 찾은 충전기 비율의 상한. 넘으면 M2 랭킹을 믿을 수 없다.
POP_GATE = 0.05


def aggregate_region(df: pd.DataFrame, by: str) -> pd.DataFrame:
    """충전기 테이블을 지역 단위로 집계한다.

    대시보드도 이 함수를 재사용한다 -- 필터가 걸린 프레임에 다시 적용해야
    M3/M5 가 필터를 반영한다. 지표 정의가 여기 한 곳에만 있어야 한다.
    """
    live = df[df["stat"].isin([STAT_AVAILABLE, STAT_IN_USE])]
    available = live[live["stat"] == STAT_AVAILABLE].groupby(by).size()

    out = pd.DataFrame(
        {
            "charger_count": df.groupby(by).size(),
            "station_count": df.groupby(by)["statId"].nunique(),
            "fast_count": df[df["is_fast"]].groupby(by).size(),
            "live_count": live.groupby(by).size(),
            "available_count": available,
        }
    ).fillna(0)

    int_cols = ["charger_count", "station_count", "fast_count", "live_count", "available_count"]
    out[int_cols] = out[int_cols].astype(int)

    return apply_metrics(out).reset_index()


def load_kepco_ev() -> pd.DataFrame:
    """한전 지역별 전기차 현황. wide(17개 시도 컬럼) -> long. 최신 기준일만 사용."""
    # thousands=",": 현재 파일은 콤마 없는 정수라 없어도 통과하지만, 공공데이터는
    # 개정될 때 천단위 구분자가 붙는 일이 흔하다. 그때 to_numeric 이 조용히 NaN 을
    # 만들면 시도 조인 가드에 걸려 터진다 -- 애초에 막는다.
    df = pd.read_csv(KEPCO_PATH, encoding="cp949", thousands=",")
    latest = df.sort_values("기준일").iloc[-1]
    ev_date = latest["기준일"]

    ref = pd.read_csv(REF_DIR / "sido_name_map.csv", dtype=str)
    ev = latest.drop("기준일").rename_axis("kepco_name").reset_index(name="ev_count")
    ev["ev_count"] = pd.to_numeric(ev["ev_count"])

    merged = ev.merge(ref, on="kepco_name", how="outer", indicator=True)
    unmatched = merged[merged["_merge"] != "both"]["kepco_name"].tolist()
    if unmatched:
        raise RuntimeError(f"한전 시도명 매핑 실패: {unmatched}")

    merged.attrs["ev_date"] = ev_date
    return merged[["zcode", "sido_full", "ev_count"]].assign(ev_date=ev_date)


def _read_jumin(path: Path) -> pd.DataFrame:
    """주민등록 CSV -> code10 + population. 시도 파일과 시군구 파일 모두 같은 스키마다."""
    df = pd.read_csv(path, encoding="cp949", thousands=",")
    region_col = df.columns[0]
    pop_col = next(c for c in df.columns if "총인구수" in c)

    # "서울특별시 종로구  (1111000000)" -> 괄호 안 10자리가 행정구역 코드
    codes = df[region_col].str.extract(r"\((\d{10})\)")[0]
    out = pd.DataFrame({
        "code10": codes,
        "population": pd.to_numeric(df[pop_col], errors="coerce"),
    }).dropna(subset=["code10"])

    return out[out["code10"] != NATIONWIDE_CODE10]  # "전국" 합계행 제외


@dataclass(frozen=True)
class Population:
    """인구 데이터와 그 해상도. 늘 함께 다니므로 한 타입으로 묶는다.

    `(df, "sgg"|"sido")` 튜플을 돌려주면 호출부마다 그 문자열로 다시 분기하게 된다.
    """

    table: pd.DataFrame
    key: str  # 조인 키 컬럼: "zscode"(시군구) 또는 "zcode"(시도)
    label: str  # UI 표기: "시군구" 또는 "시도"

    @property
    def is_sigungu(self) -> bool:
        return self.key == "zscode"


def load_population() -> Population | None:
    """인구 데이터를 **가장 높은 해상도**로 로드한다.

    시군구 파일이 있으면 시군구(~230개), 없으면 시도 파일로 시도(17개) 단위.
    둘 다 없으면 None -- 접근성 지표를 건너뛴다.
    """
    if JUMIN_SGG_PATH.exists():
        raw = _read_jumin(JUMIN_SGG_PATH)
        is_sido_row = raw["code10"].str.endswith("00000000")

        # 세종은 시군구가 없는 유일한 광역단체다. 주민등록에는 시도 행
        # "세종특별자치시 (3600000000)" 하나로만 나오지만, 충전소 API 는 세종 충전기에
        # zscode=36110 을 준다. 시도 행이라고 버리면 세종 충전기 6,474기가 접근성
        # 랭킹에서 통째로 사라진다 -- 결측률 게이트도 못 잡는다.
        sejong = raw[raw["code10"] == SEJONG_CODE10].assign(zscode=SEJONG_ZSCODE)
        sigungu = raw[~is_sido_row].assign(zscode=raw["code10"].str[:5])

        pop = pd.concat([sigungu, sejong])[["zscode", "population"]]

        # 인천 개편으로 중구/동구 경계가 사라졌다. clean.canonicalize_incheon 이 충전기를
        # 중구(28110)로 모으므로 인구 분모도 합친다. 안 합치면 중구 M2 가 과대평가된다.
        pop["zscode"] = pop["zscode"].replace(INCHEON_POP_MERGE)
        pop = pop.groupby("zscode", as_index=False)["population"].sum()

        return Population(
            pop.astype({"population": int}).reset_index(drop=True), key="zscode", label="시군구"
        )

    if JUMIN_SIDO_PATH.exists():
        raw = _read_jumin(JUMIN_SIDO_PATH)
        pop = raw.assign(zcode=raw["code10"].str[:2])[["zcode", "population"]]
        return Population(
            pop.astype({"population": int}).reset_index(drop=True), key="zcode", label="시도"
        )

    return None


def _join_population(out: pd.DataFrame, population: Population) -> pd.DataFrame:
    """인구를 붙이고 M2 를 만든다. 시도(zcode)와 시군구(zscode) 양쪽에 쓴다."""
    key, table = population.key, population.table

    # 키가 중복되면 merge 가 행을 팬아웃시켜 지역을 이중집계한다.
    # 결측 검사로는 잡히지 않으므로 여기서 먼저 막는다.
    dupes = table[table[key].duplicated()][key].tolist()
    if dupes:
        raise RuntimeError(f"인구 데이터에 {key} 중복 -> M2 이중집계 위험: {dupes[:10]}")

    out = out.merge(table, on=key, how="left")

    # 결측은 **충전기 수로 가중**해서 잰다. 지역 행 수로 재면, 충전기가 많이 몰린
    # 지역 하나가 통째로 빠져도 "1/230 = 0.4%" 로 보여 게이트를 그냥 통과한다.
    # (세종 6,474기 = 행으로는 0.4% 지만 충전기로는 1.25% 다.)
    unmatched = out[out["population"].isna()]
    lost = int(unmatched["charger_count"].sum())
    ratio = lost / max(int(out["charger_count"].sum()), 1)

    print(
        f"[인구 결측] 지역 {len(unmatched)}곳 / 충전기 {lost:,}기 "
        f"({ratio:.2%}, 기준 <{POP_GATE:.0%})"
    )
    if ratio >= POP_GATE:
        raise RuntimeError(
            f"인구를 못 찾은 충전기가 {ratio:.2%} 입니다. 미매칭 {key}: {unmatched[key].tolist()[:20]}"
        )

    return apply_metrics(out)


def build_sido(chargers: pd.DataFrame, population: Population | None = None) -> pd.DataFrame:
    agg = aggregate_region(chargers, "zcode")
    ev = load_kepco_ev()

    out = agg.merge(ev, on="zcode", how="outer")
    missing = out["ev_count"].isna().sum()
    if missing:
        raise RuntimeError(f"시도 조인 실패: ev_count 결측 {missing}건")

    out = apply_metrics(out)

    # 시군구 인구 파일이 없을 때는 시도 단위로라도 접근성 지표를 낸다.
    if population is not None:
        out = _join_population(out, population)

    return out.sort_values("M1_chargers_per_1k_ev")


def build_sgg(chargers: pd.DataFrame, population: Population) -> pd.DataFrame:
    dropped = int(chargers["zscode"].isna().sum())
    if dropped:
        print(f"[M2] zscode 결측 {dropped:,}행 제외")

    agg = aggregate_region(chargers.dropna(subset=["zscode"]), "zscode")
    ref = pd.read_csv(REF_DIR / "zscode_map.csv", dtype=str)
    out = agg.merge(ref, on="zscode", how="left")

    counted = int(out["charger_count"].sum())
    if counted != len(chargers) - dropped:
        raise RuntimeError(
            f"시군구 집계 누락: sum={counted:,} != 대상 {len(chargers) - dropped:,}"
        )

    out = _join_population(out, population)
    return out.sort_values("M2_chargers_per_100k_pop")


def main() -> None:
    if not CLEAN_PATH.exists():
        sys.exit("정제 테이블이 없습니다. 먼저 `python src/clean.py` 를 실행하세요.")

    chargers = pd.read_parquet(CLEAN_PATH)
    print(f"정제 테이블: {len(chargers):,} 행")

    population = load_population()
    if population is None:
        print(
            f"\n[M2 skip] 인구 파일이 없습니다.\n"
            f"  시군구: {JUMIN_SGG_PATH.name}  (고해상도, 권장)\n"
            f"  시도  : {JUMIN_SIDO_PATH.name}  (저해상도)\n"
            "  jumin.mois.go.kr 에서 받아 data/raw/ 에 넣으면 자동으로 켜집니다."
        )
    else:
        print(f"인구 데이터: {population.label} 단위 {len(population.table)}개 지역")

    # 시군구 인구가 있으면 M2 는 시군구 테이블에서 낸다. 없으면 시도 테이블에 붙인다.
    sido = build_sido(chargers, None if population is None or population.is_sigungu else population)

    total = int(sido["charger_count"].sum())
    if total != len(chargers):
        raise RuntimeError(f"집계 누락: sum(charger_count)={total:,} != 정제 행수 {len(chargers):,}")
    print(f"[집계 무결성] sum(charger_count)={total:,} == 정제 행수 OK")

    sido.to_parquet(PROCESSED_DIR / "metrics_sido.parquet", index=False)
    print(f"저장: metrics_sido.parquet ({len(sido)} 행)")

    worst = sido.iloc[0]
    print(f"\nM1 최하위(가장 부족): {worst['sido_full']} "
          f"{worst['M1_chargers_per_1k_ev']:.1f} 기/EV1000대")

    if population is None:
        return

    if not population.is_sigungu:
        low = sido.sort_values("M2_chargers_per_100k_pop").iloc[0]
        print(f"M2 최하위(접근성 취약, 시도): {low['sido_full']} "
              f"{low['M2_chargers_per_100k_pop']:.1f} 기/인구10만")
        print("\n시군구 인구 CSV 를 넣으면 접근성 랭킹이 230개 시군구로 올라갑니다.")
        return

    sgg = build_sgg(chargers, population)
    sgg.to_parquet(PROCESSED_DIR / "metrics_sgg.parquet", index=False)
    print(f"저장: metrics_sgg.parquet ({len(sgg)} 행)")

    worst_sgg = sgg.iloc[0]
    print(f"M2 최하위(접근성 취약): {worst_sgg['sido']} {worst_sgg['sigungu']} "
          f"{worst_sgg['M2_chargers_per_100k_pop']:.1f} 기/인구10만")


if __name__ == "__main__":
    main()
