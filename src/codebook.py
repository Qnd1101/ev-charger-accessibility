"""공식 충전기 상태 코드표와 정적 집계 기준.

상태 라벨은 OpenAPI 활용가이드 v1.23 공통코드 3.2절을 따르고, 약 52만 좌표를
브라우저에 직접 보내지 않도록 지도 격자 크기를 약 2km(0.02도)로 고정한다.
"""

from __future__ import annotations

import pandas as pd

# 활용가이드 v1.23 의 **공통코드 3.2절** 전체다. getChargerInfo 필드 설명은 0~5 만
# 적어놓았지만 코드표에는 6(예약중)과 9(상태미확인)가 더 있다. 필드 설명만 보고 옮기면
# 코드북이 새는데, 실데이터에 6 이 0건이라 "실데이터를 다 덮는가" 식 테스트는 그냥 통과한다.
# 그래서 테스트는 실데이터가 아니라 이 공식 코드표를 기준으로 검증한다.
STAT_LABELS = {
    "0": "알수없음", "1": "통신이상", "2": "충전대기",
    "3": "충전중", "4": "운영중지", "5": "점검중",
    "6": "예약중", "9": "상태미확인",
}

# 지도 격자 크기(도). 0.02도 ~= 2km. 52만 포인트를 그대로 pydeck 에 넘기면
# 브라우저로 가는 JSON 이 40MB 가 된다 -- folium 마커를 피한 이유와 똑같은 문제다.
# 서버에서 미리 격자 집계하면 8천 셀(1.7%)로 줄어든다.
GRID_DEG = 0.02

# 지도와 필터에 필요한 컬럼만 읽는다. 40컬럼 전체를 읽으면 로드가 5배 느리다.
MAP_COLUMNS = [
    "statId", "zcode", "zscode", "lat", "lng", "coord_valid",
    "is_fast", "stat", "busiNm", "useTime",
]


def label_stat(stat: pd.Series) -> pd.Series:
    """코드북에 없는 stat 값도 라벨을 갖게 한다 -- 집계에서 조용히 빠지면 안 된다."""
    return stat.map(STAT_LABELS).fillna("미정의(" + stat.astype(str) + ")")


def grid_aggregate(points: pd.DataFrame, deg: float = GRID_DEG) -> pd.DataFrame:
    """좌표를 격자로 묶어 셀당 충전기 수를 센다. 지도 payload 를 1/50 로 줄인다."""
    binned = points.assign(
        lat=(points["lat"] / deg).round() * deg,
        lng=(points["lng"] / deg).round() * deg,
    )
    return binned.groupby(["lat", "lng"], as_index=False).size().rename(columns={"size": "count"})


def build_ranking_view(
    base: pd.DataFrame,
    agg: pd.DataFrame,
    key: str,
    *,
    denominator: str,
    per: int,
    metric_label: str,
) -> pd.DataFrame:
    """랭킹 표의 데이터를 만드는 순수 계산이다.

    `agg` 는 **필터된** 충전기 프레임을 metrics.aggregate_region 에 통과시킨 결과여야 한다.
    그래야 M3/M5 도 필터를 반영한다 -- 안 그러면 "급속만" 필터에서 급속 비율이 26%로 나온다.
    """
    view = base.merge(agg, on=key, how="left").fillna(
        {"charger_count": 0, "fast_count": 0, "M3_fast_ratio": 0}
    )
    view[metric_label] = view["charger_count"] / (view[denominator] / per)
    return view.sort_values(metric_label)


def unit_badge(unit: str) -> str:
    return f":gray-badge[{unit} 단위]"


def basis_footnote(snapshot: str, ev_date: str, has_population: bool) -> str:
    pretty = f"{snapshot[:4]}-{snapshot[4:6]}-{snapshot[6:]}" if len(snapshot) == 8 else snapshot
    pop = "2026-06" if has_population else "N/A"
    return (
        f"기준시점 — 충전기: **{pretty}** 스냅샷 · "
        f"전기차 등록: **{ev_date}** · 인구: **{pop}**  \n"
        f"세 데이터의 기준일이 다릅니다. 지표 비교 시 감안하세요."
    )
