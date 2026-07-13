"""React 화면용 희소 집계 생성.

원본 51만 건을 브라우저로 보내지 않는다. 대신 **필터 차원별로 미리 집계한** 표를
내보내고, 화면은 선택된 조합만 합산한다(DESIGN.md `성능`, `데이터 경계`).

필터 네 개(시도·속도·운영기관·24시간)의 실제 조합 수는 희소하다:
  - 지역 큐브: zscode x 운영기관 x 속도 x 24시간   ~3만행
  - 격자 큐브: 2km 셀 x 시도 x 운영기관 x 속도 x 24시간  ~5.6만행
둘 다 원본의 10% 미만이라 정적 파일로 충분하다.

**충전소 수(station_count)는 합산이 안 된다.** 한 충전소에 급속·완속이 섞여 있으면
(6,216개 / 100,600개) 속도 슬라이스를 더할 때 중복 계상된다. 그래서 속도와 24시간은
원자 슬라이스가 아니라 **합집합까지 미리 계산**해 둔다(speed: 전체/급속/완속,
h24: 전체/24시간만). 지역·운영기관 방향의 합산은 화면이 한다.

  남은 한계: 한 충전소가 여러 (지역, 운영기관) 조합에 걸쳐 있으면(558개, 0.55%)
  지역·운영기관을 여러 개 고를 때 충전소 수가 그만큼 과대집계된다. 상한을
  `meta.station_overcount_max` 로 내보내 화면이 각주로 알린다.
  충전기 수·M1·M2·M3 는 영향 없다.

usage:
    python scripts/build_web_data.py
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
BOUNDARY_PATH = ROOT / "data" / "ref" / "sigungu.topo.json"
sys.path.insert(0, str(ROOT / "src"))

from display import GRID_DEG, STAT_LABELS, label_stat  # noqa: E402
from metric_specs import to_json as metric_specs_json  # noqa: E402
from metrics import (  # noqa: E402
    CLEAN_PATH,
    JUMIN_SGG_PATH,
    JUMIN_SIDO_PATH,
    PROCESSED_DIR,
    STAT_AVAILABLE,
    STAT_IN_USE,
    load_kepco_ev,
    load_population,
)

OUT_DIR = ROOT / "prototype" / "public" / "data"

# 속도·24시간은 합집합 슬라이스까지 만든다. 충전소 수가 합산 불가라서다(모듈 독스트링).
SPEED_ALL, SPEED_FAST, SPEED_SLOW = 0, 1, 2
H24_ALL, H24_ONLY = 0, 1

TOP_OPERATORS = 10  # 필터 레일의 "상위 10개 빠른 선택"


def _slices(df: pd.DataFrame) -> list[tuple[int, int, pd.DataFrame]]:
    """(speed, h24) 6개 슬라이스. 각 슬라이스는 그 조건을 만족하는 충전기 전체다."""
    out = []
    for h24, h_df in ((H24_ALL, df), (H24_ONLY, df[df["h24"]])):
        out.append((SPEED_ALL, h24, h_df))
        out.append((SPEED_FAST, h24, h_df[h_df["is_fast"]]))
        out.append((SPEED_SLOW, h24, h_df[~h_df["is_fast"]]))
    return out


def build_region_cube(df: pd.DataFrame, op_idx: dict[str, int]) -> list[list[int]]:
    """[zscode, opIdx, speed, h24, 충전기, 충전소, 급속, 응답, 사용가능] 행.

    다섯 카운트를 **모든 슬라이스에** 싣는다. 그래야 화면의 지표 평가기가 큐브만 더해서
    M3~M5 를 낼 수 있고, "속도 필터가 걸리면 급속 비율은 정의상 100%" 같은 특수 분기를
    TypeScript 에 둘 필요가 없다 -- 급속 슬라이스 안에서는 fast == chargers 라서 저절로 1 이
    나온다. 공식은 `metric_specs.METRICS` 한 곳에만 있어야 한다(AGENTS.md).
    """
    rows: list[list[int]] = []
    for speed, h24, sl in _slices(df):
        live = sl[sl["stat"].isin([STAT_AVAILABLE, STAT_IN_USE])]
        agg = sl.groupby(["zscode", "busiNm"]).agg(
            chargers=("statId", "size"),
            stations=("statId", "nunique"),
        )
        agg["fast"] = sl[sl["is_fast"]].groupby(["zscode", "busiNm"]).size()
        agg["live"] = live.groupby(["zscode", "busiNm"]).size()
        agg["available"] = (
            live[live["stat"] == STAT_AVAILABLE].groupby(["zscode", "busiNm"]).size()
        )
        agg = agg.fillna(0).astype(int).reset_index()

        rows.extend(
            [
                int(r.zscode),
                op_idx[r.busiNm],
                speed,
                h24,
                r.chargers,
                r.stations,
                r.fast,
                r.live,
                r.available,
            ]
            for r in agg.itertuples()
        )
    return rows


def build_status_cube(
    df: pd.DataFrame, op_idx: dict[str, int], labels_order: list[str]
) -> list[list[int]]:
    """[zscode, opIdx, speed, h24, <labels_order 순서대로 충전기 수>] 행.

    개요 패널의 "충전기 상태 분포" 표용. region_cube 와 같은 (zscode, busiNm, speed, h24)
    키를 쓰지만 값이 5개 지표 대신 상태 코드별 개수다 -- 화면은 필터에 맞는 행만 더한다.
    `label_stat` 로 코드북에 없는 stat 값도 라벨을 갖게 한다(display.py) -- 조용히 빠지면
    안 된다.
    """
    rows: list[list[int]] = []
    for speed, h24, sl in _slices(df):
        counts = (
            sl.assign(stat_label=label_stat(sl["stat"]))
            .groupby(["zscode", "busiNm", "stat_label"])
            .size()
            .unstack(fill_value=0)
            .reindex(columns=labels_order, fill_value=0)
        )
        rows.extend(
            [int(zscode), op_idx[busi_nm], speed, h24, *(int(v) for v in row)]
            for (zscode, busi_nm), row in counts.iterrows()
        )
    return rows


def build_grid_cube(df: pd.DataFrame, op_idx: dict[str, int]) -> list[list[int]]:
    """[latE3, lngE3, zcode, opIdx, fast, h24only, 충전기] 행.

    충전기 수는 합산 가능하므로 격자는 **원자 슬라이스**(급속/완속 x 24시간/그외)만
    내보내고 화면이 더한다. 좌표는 격자에 스냅된 값이라 정수 1/1000도로 무손실 저장한다.
    시도 필터를 지도에도 적용해야 해서 zcode 를 키에 포함한다(셀이 시도 경계를 넘을 수 있다).
    """
    pts = df[df["coord_valid"]].copy()
    pts["glat"] = ((pts["lat"] / GRID_DEG).round() * GRID_DEG * 1000).round().astype(int)
    pts["glng"] = ((pts["lng"] / GRID_DEG).round() * GRID_DEG * 1000).round().astype(int)

    g = (
        pts.groupby(["glat", "glng", "zcode", "busiNm", "is_fast", "h24"])
        .size()
        .reset_index(name="n")
    )
    return [
        [r.glat, r.glng, int(r.zcode), op_idx[r.busiNm], int(r.is_fast), int(r.h24), r.n]
        for r in g.itertuples()
    ]


def main() -> None:
    if not CLEAN_PATH.exists():
        sys.exit("정제 테이블이 없습니다. `python src/clean.py` 를 먼저 실행하세요.")

    df = pd.read_parquet(
        CLEAN_PATH,
        columns=[
            "statId", "zcode", "zscode", "lat", "lng", "coord_valid",
            "is_fast", "stat", "busiNm", "useTime",
        ],
    )
    # 지역·기관을 모르는 행은 큐브에 넣을 수 없다. 하지만 조용히 버리면 화면의 "전국 N기"가
    # 파이프라인과 어긋난다(그리고 아무도 눈치채지 못한다). 버린 수를 세어 meta 로 내보낸다.
    total_chargers = len(df)
    df = df.dropna(subset=["zscode", "busiNm"])
    unplaced = total_chargers - len(df)

    df["h24"] = df["useTime"].str.contains("24시간", na=False)

    operators = df["busiNm"].value_counts()  # 충전기 수 내림차순 -> 상위 10개가 앞에 온다
    op_names = list(operators.index)
    op_idx = {name: i for i, name in enumerate(op_names)}

    # 상태 라벨 순서는 코드북 순서(STAT_LABELS)를 우선하고, 코드북에 없는 값이 실제로
    # 있으면 그 라벨을 뒤에 덧붙인다 -- 스냅샷마다 열 순서가 흔들리지 않아야 화면이 매 필터
    # 조합에서 같은 열 인덱스를 더할 수 있다.
    known_labels = list(STAT_LABELS.values())
    extra_labels = sorted(set(label_stat(df["stat"]).unique()) - set(known_labels))
    status_labels = known_labels + extra_labels

    sido = pd.read_parquet(PROCESSED_DIR / "metrics_sido.parquet")
    population = load_population()
    ev = load_kepco_ev()

    # 지역 기준표: 필터 결과가 0인 지역도 "미진출"로 남아야 하므로 전체 목록을 내보낸다.
    ref = pd.read_csv(ROOT / "data" / "ref" / "zscode_map.csv", dtype=str)

    # 인구는 시군구 파일이 없으면 시도 해상도로 떨어진다(metrics.load_population).
    # 그때 시군구 인구만 내보내면 M2 랭킹이 **말없이 빈 화면**이 된다. 해상도에 맞는 쪽에 싣는다.
    is_sgg_pop = population is not None and population.is_sigungu
    pop_by_key = (
        dict(zip(population.table[population.key], population.table["population"]))
        if population
        else {}
    )

    regions = [
        {
            "zscode": int(r.zscode),
            "zcode": int(r.zcode),
            "sido": r.sido,
            "sigungu": r.sigungu,
            "population": int(pop_by_key[r.zscode]) if is_sgg_pop and r.zscode in pop_by_key else None,
        }
        for r in ref.itertuples()
    ]

    sidos = [
        {
            "zcode": int(r.zcode),
            "name": r.sido_full,
            "ev_count": int(r.ev_count),
            "population": (
                int(pop_by_key[r.zcode]) if not is_sgg_pop and r.zcode in pop_by_key else None
            ),
        }
        for r in ev.itertuples()
    ]

    snapshot = sorted((ROOT / "data" / "raw").glob("chargers_*.parquet"))[-1].stem[-8:]

    # 기준일은 신뢰 신호다(DESIGN.md). 리터럴로 박으면 다른 월 파일을 넣었을 때
    # 화면이 **틀린 기준일을 자신 있게** 표시한다. 파일명에서 유도한다.
    pop_stem = (JUMIN_SGG_PATH if is_sgg_pop else JUMIN_SIDO_PATH).stem  # jumin_sgg_202606
    pop_ym = pop_stem.rsplit("_", 1)[-1]
    meta = {
        "snapshot_date": f"{snapshot[:4]}-{snapshot[4:6]}-{snapshot[6:]}",
        "ev_date": str(sido["ev_date"].iloc[0]),
        "population_date": f"{pop_ym[:4]}-{pop_ym[4:]}" if population else None,
        "population_label": population.label if population else None,
        "total_chargers": total_chargers,
        # 지역·기관 결측으로 큐브에 넣지 못한 충전기. 0 이 아니면 화면이 각주로 알려야 한다.
        "unplaced_chargers": unplaced,
        "invalid_coord_chargers": int((~df["coord_valid"]).sum()),
        "grid_deg": GRID_DEG,
        "top_operators": op_names[:TOP_OPERATORS],
        # 충전소 수 과대집계의 정확한 상한(모듈 독스트링). 한 충전소가 여러 (지역, 운영기관)
        # 조합에 걸치면 그만큼 중복 계상된다. 추정하지 않고 실제 조합 수로 센다.
        "station_overcount_max": int(
            len(df[["statId", "zscode", "busiNm"]].drop_duplicates())
            - df["statId"].nunique()
        ),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta.json": meta,
        # 지표 공식의 정의. 화면은 이 표를 읽어 나누기만 한다 -- 공식을 재구현하지 않는다.
        "metrics.json": metric_specs_json(),
        "operators.json": op_names,
        "regions.json": {"regions": regions, "sidos": sidos},
        "region_cube.json": build_region_cube(df, op_idx),
        "status_cube.json": {
            "labels": status_labels,
            "rows": build_status_cube(df, op_idx, status_labels),
        },
        "grid_cube.json": build_grid_cube(df, op_idx),
    }
    for name, obj in payload.items():
        path = OUT_DIR / name
        path.write_text(
            json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1e6:.2f} MB")

    # 경계는 생성 데이터가 아니라 커밋된 참조 자산이다. 앱이 읽는 public/data에 함께
    # 게시해야 새 체크아웃에서도 코로플레스가 조용히 격자로 강등되지 않는다.
    boundary_output = OUT_DIR / BOUNDARY_PATH.name
    shutil.copyfile(BOUNDARY_PATH, boundary_output)
    print(f"{boundary_output.relative_to(ROOT)}: {boundary_output.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
