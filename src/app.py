"""전기차 충전소 분포·접근성 대시보드.

API 를 호출하지 않는다. data/processed/ 의 Parquet 스냅샷만 읽는다.

usage:
    streamlit run src/app.py
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pydeck as pdk
import streamlit as st

from display import (
    BASEMAP,
    MAP_COLUMNS,
    basis_footnote,
    build_ranking_view,
    grid_aggregate,
    label_stat,
    unit_badge,
)
from metrics import aggregate_region

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
RAW = ROOT / "data" / "raw"

CLEAN_PATH = PROCESSED / "chargers_clean.parquet"
SIDO_PATH = PROCESSED / "metrics_sido.parquet"
SGG_PATH = PROCESSED / "metrics_sgg.parquet"

st.set_page_config(
    page_title="CHARGE GRID | 전기차 충전 인프라",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');

    :root {
        --grid-bg: #07111f;
        --grid-panel: rgba(13, 27, 42, 0.88);
        --grid-panel-strong: #102338;
        --grid-line: rgba(143, 174, 199, 0.18);
        --grid-text: #f3f7fa;
        --grid-muted: #9cb0c2;
        --grid-lime: #c7ff3d;
        --grid-cyan: #31d7e8;
        --grid-amber: #ffbd59;
    }

    html, body, [class*="css"] { font-family: "IBM Plex Sans KR", sans-serif; }
    .stApp {
        background:
            linear-gradient(rgba(49, 215, 232, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(49, 215, 232, 0.035) 1px, transparent 1px),
            radial-gradient(circle at 78% 4%, rgba(49, 215, 232, 0.12), transparent 28rem),
            radial-gradient(circle at 8% 18%, rgba(199, 255, 61, 0.08), transparent 24rem),
            var(--grid-bg);
        background-size: 32px 32px, 32px 32px, auto, auto, auto;
    }
    .block-container { max-width: 1480px; padding-top: 2.2rem; padding-bottom: 5rem; }
    h1, h2, h3, [data-testid="stMetricValue"] {
        font-family: "Space Grotesk", "IBM Plex Sans KR", sans-serif !important;
        letter-spacing: -0.025em;
    }
    h2, h3 { color: var(--grid-text); }
    p, [data-testid="stCaptionContainer"] { color: var(--grid-muted); }

    .grid-hero {
        position: relative;
        overflow: hidden;
        padding: clamp(1.5rem, 4vw, 3.2rem);
        margin-bottom: 1rem;
        border: 1px solid rgba(49, 215, 232, 0.28);
        border-radius: 18px;
        background: linear-gradient(120deg, rgba(16, 35, 56, 0.98), rgba(7, 17, 31, 0.88));
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.28), inset 0 1px rgba(255, 255, 255, 0.04);
        animation: grid-rise .55s ease-out both;
    }
    .grid-hero::after {
        content: "";
        position: absolute;
        width: 22rem; height: 22rem; right: -8rem; top: -12rem;
        border: 1px solid rgba(199, 255, 61, 0.2);
        border-radius: 50%;
        box-shadow: 0 0 0 3rem rgba(49, 215, 232, 0.025), 0 0 0 7rem rgba(49, 215, 232, 0.02);
    }
    .grid-kicker {
        color: var(--grid-cyan); font: 600 .72rem/1 "Space Grotesk", sans-serif;
        letter-spacing: .18em; text-transform: uppercase;
    }
    .grid-hero h1 {
        max-width: 920px; margin: .8rem 0 .7rem; color: var(--grid-text);
        font-size: clamp(2rem, 4.8vw, 4.6rem); line-height: .98;
    }
    .grid-hero h1 span { color: var(--grid-lime); }
    .grid-hero p { max-width: 720px; margin: 0; font-size: 1rem; line-height: 1.75; }
    .grid-live {
        display: inline-flex; align-items: center; gap: .55rem; margin-top: 1.35rem;
        padding: .5rem .8rem; border: 1px solid rgba(199, 255, 61, .28);
        border-radius: 999px; color: var(--grid-lime); background: rgba(199, 255, 61, .06);
        font: 600 .72rem/1 "Space Grotesk", sans-serif; letter-spacing: .08em;
    }
    .grid-live::before { content: ""; width: .45rem; height: .45rem; border-radius: 50%; background: var(--grid-lime); box-shadow: 0 0 12px var(--grid-lime); }
    .filter-strip {
        display: flex; flex-wrap: wrap; gap: .55rem; align-items: center;
        margin: .75rem 0 1.35rem; padding: .8rem 1rem;
        border-left: 3px solid var(--grid-cyan); background: rgba(13, 27, 42, .62);
    }
    .filter-strip strong { color: var(--grid-text); }
    .filter-chip { padding: .3rem .6rem; border-radius: 6px; color: var(--grid-cyan); background: rgba(49, 215, 232, .09); font-size: .78rem; }

    [data-testid="stSidebar"] { background: rgba(6, 15, 27, .98); border-right: 1px solid var(--grid-line); }
    [data-testid="stSidebar"] h2 { color: var(--grid-lime); font-size: 1.1rem; letter-spacing: .08em; }
    [data-testid="stSidebar"] [data-testid="stMetric"] { border-color: rgba(199, 255, 61, .28); }
    [data-testid="stMetric"] {
        min-height: 128px; padding: 1.15rem 1.2rem;
        border: 1px solid var(--grid-line); border-radius: 12px;
        background: linear-gradient(145deg, rgba(16, 35, 56, .94), rgba(10, 24, 39, .88));
        box-shadow: inset 0 3px 0 rgba(49, 215, 232, .32), 0 16px 34px rgba(0, 0, 0, .16);
    }
    [data-testid="stMetricLabel"] { color: var(--grid-muted); text-transform: uppercase; letter-spacing: .08em; }
    [data-testid="stMetricValue"] { color: var(--grid-text); font-size: clamp(1.7rem, 3vw, 2.7rem); }
    [data-testid="stMetric"]::after { content: ""; display: block; width: 2rem; height: 2px; margin-top: .8rem; background: var(--grid-lime); }

    .stTabs [data-baseweb="tab-list"] { gap: .35rem; padding: .35rem; border: 1px solid var(--grid-line); border-radius: 12px; background: rgba(13, 27, 42, .76); }
    .stTabs [data-baseweb="tab"] { height: 3rem; padding: 0 1.1rem; border-radius: 8px; color: var(--grid-muted); }
    .stTabs [aria-selected="true"] { color: #07111f !important; background: var(--grid-lime) !important; font-weight: 700; }
    .stTabs [data-baseweb="tab-highlight"] { display: none; }
    [data-testid="stDataFrame"], [data-testid="stDeckGlJsonChart"], [data-testid="stVegaLiteChart"] {
        overflow: hidden; border: 1px solid var(--grid-line); border-radius: 12px;
        background: var(--grid-panel); padding: .35rem;
    }
    [data-testid="stAlert"] { border-radius: 10px; border: 1px solid var(--grid-line); }
    hr { border-color: var(--grid-line) !important; }
    :focus-visible { outline: 2px solid var(--grid-lime) !important; outline-offset: 2px; }
    footer { visibility: hidden; }

    @keyframes grid-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .grid-hero { animation: none; } }
    @media (max-width: 768px) {
        .block-container { padding: 1rem .8rem 3rem; }
        .grid-hero { border-radius: 12px; }
        .grid-hero h1 { font-size: 2.3rem; }
        .stTabs [data-baseweb="tab"] { padding: 0 .65rem; font-size: .78rem; }
        [data-testid="stMetric"] { min-height: 108px; }
    }
    </style>
    """,
    unsafe_allow_html=True,
)

cached_grid_aggregate = st.cache_data(grid_aggregate)


@st.cache_data
def load_chargers() -> pd.DataFrame:
    return pd.read_parquet(CLEAN_PATH, columns=MAP_COLUMNS)


@st.cache_data
def load_sido() -> pd.DataFrame:
    return pd.read_parquet(SIDO_PATH)


@st.cache_data
def load_sgg() -> pd.DataFrame | None:
    return pd.read_parquet(SGG_PATH) if SGG_PATH.exists() else None


@st.cache_data
def snapshot_date() -> str:
    snaps = sorted(RAW.glob("chargers_*.parquet"))
    return snaps[-1].stem.replace("chargers_", "") if snaps else "unknown"


if not CLEAN_PATH.exists() or not SIDO_PATH.exists():
    st.error(
        "데이터가 없습니다. 아래 순서로 먼저 실행하세요.\n\n"
        "```\npython src/collect.py\npython src/clean.py\npython src/metrics.py\n```"
    )
    st.stop()

chargers = load_chargers()
sido_metrics = load_sido()
sgg_metrics = load_sgg()
ev_date = str(sido_metrics["ev_date"].iloc[0])

# ---------------------------------------------------------------- 사이드바 필터
st.sidebar.markdown("## CONTROL DECK")
st.sidebar.caption("분석 범위를 조정하면 모든 지표와 지도가 함께 갱신됩니다.")

sido_names = sorted(sido_metrics["sido_full"].dropna())
picked_sido = st.sidebar.multiselect("시도", sido_names, default=[])

speed = st.sidebar.radio("충전 속도", ["전체", "급속만", "완속만"], horizontal=True)

operators = sorted(chargers["busiNm"].dropna().unique())
picked_op = st.sidebar.multiselect("운영기관", operators, default=[])

only_24h = st.sidebar.checkbox("24시간 이용가능만")

filtered = chargers
if picked_sido:
    zcodes = sido_metrics[sido_metrics["sido_full"].isin(picked_sido)]["zcode"]
    filtered = filtered[filtered["zcode"].isin(zcodes)]
if speed == "급속만":
    filtered = filtered[filtered["is_fast"]]
elif speed == "완속만":
    filtered = filtered[~filtered["is_fast"]]
if picked_op:
    filtered = filtered[filtered["busiNm"].isin(picked_op)]
if only_24h:
    filtered = filtered[filtered["useTime"].str.contains("24시간", na=False)]

st.sidebar.metric("필터 후 충전기", f"{len(filtered):,}")
if filtered.empty:
    st.warning("필터 조건에 맞는 충전기가 없습니다. 조건을 완화하세요.")
    st.stop()

# ---------------------------------------------------------------- 헤더
st.markdown(
    """
    <section class="grid-hero">
      <div class="grid-kicker">Korea EV Infrastructure Observatory</div>
      <h1>CHARGE <span>GRID</span><br>대한민국 충전 인프라</h1>
      <p>전국 충전기 분포와 수요 대비 공급 격차를 하나의 관제 화면에서 탐색합니다.</p>
      <div class="grid-live">LOCAL SNAPSHOT · NO LIVE API</div>
    </section>
    """,
    unsafe_allow_html=True,
)
st.caption(basis_footnote(snapshot_date(), ev_date, SGG_PATH.exists()))

filter_labels = [
    f"시도 {len(picked_sido)}곳" if picked_sido else "전국",
    speed,
    f"운영기관 {len(picked_op)}곳" if picked_op else "전체 운영기관",
    "24시간" if only_24h else "이용시간 전체",
]
filter_chips = "".join(f'<span class="filter-chip">{label}</span>' for label in filter_labels)
st.markdown(
    f'<div class="filter-strip"><strong>ACTIVE SCOPE</strong>{filter_chips}'
    f'<span class="filter-chip">{len(filtered):,}기</span></div>',
    unsafe_allow_html=True,
)

tab_overview, tab_map, tab_shortage, tab_access = st.tabs(
    ["개요", "분포 지도", "부족 지역 랭킹", "접근성 랭킹"]
)

# ---------------------------------------------------------------- 개요
with tab_overview:
    st.subheader("전국 현황 " + unit_badge("전국"))

    # 전국 KPI 도 랭킹 표와 **같은 함수**로 낸다. 여기서 M3/M5 를 리터럴로 다시 쓰면
    # 정의가 두 벌이 되어, metrics.py 쪽만 고쳤을 때 개요 탭이 조용히 옛 정의를 보여준다.
    national = aggregate_region(filtered.assign(_all="전국"), "_all").iloc[0]

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("충전소", f"{int(national['station_count']):,}")
    c2.metric("충전기", f"{int(national['charger_count']):,}")
    c3.metric("급속 비율", f"{national['M3_fast_ratio']:.1%}")
    c4.metric(
        "가용률",
        f"{national['M5_availability']:.1%}" if pd.notna(national["M5_availability"]) else "N/A",
        help="충전대기 / (충전대기 + 충전중). 통신이상·점검중·운영중지는 분모에서 제외",
    )

    st.divider()
    left, right = st.columns(2)

    with left:
        st.markdown("**충전기 상태 분포** " + unit_badge("전국"))
        stat_counts = (
            label_stat(filtered["stat"]).value_counts().rename_axis("상태").reset_index(name="충전기 수")
        )
        st.dataframe(stat_counts, hide_index=True, use_container_width=True)
        st.caption(f"합계 {int(stat_counts['충전기 수'].sum()):,}기 — 위 '충전기' 지표와 일치해야 합니다.")

    with right:
        st.markdown("**운영기관 상위 10** " + unit_badge("전국"))
        top_ops = (
            filtered["busiNm"].value_counts().head(10).rename_axis("운영기관").reset_index(name="충전기 수")
        )
        st.dataframe(top_ops, hide_index=True, use_container_width=True)

# ---------------------------------------------------------------- 분포 지도
with tab_map:
    st.subheader("충전기 분포 " + unit_badge("좌표 격자"))

    mappable = filtered[filtered["coord_valid"]]
    invalid = len(filtered) - len(mappable)
    st.caption(
        f"지도 표시 {len(mappable):,}기. "
        f"좌표가 유효하지 않은 {invalid:,}기는 지도에서만 빠지고 **모든 집계에는 포함**됩니다."
    )

    if mappable.empty:
        # st.stop() 을 쓰면 스크립트 전체가 멈춰 다른 탭까지 죽는다. 지도만 건너뛴다.
        st.info("필터 조건에 맞는 충전기 중 지도에 표시할 수 있는 좌표가 없습니다.")
    else:
        view = st.radio("표시 방식", ["기둥(3D)", "히트맵"], horizontal=True)

        cells = cached_grid_aggregate(mappable[["lat", "lng"]])
        st.caption(
            f"격자 집계 {len(cells):,} 셀 (약 2km). "
            f"원본 {len(mappable):,} 포인트를 그대로 보내면 payload 가 40MB 가 된다."
        )

        if view == "기둥(3D)":
            # 색은 최대 셀 기준으로 정규화한다. 고정 계수를 쓰면 deck.gl 이 255 에서 잘라내
            # 일정 밀도 이상 셀이 전부 같은 색이 되어 색상 채널이 죽는다.
            peak = max(int(cells["count"].max()), 1)
            layer = pdk.Layer(
                "ColumnLayer",
                data=cells.assign(shade=(cells["count"] / peak * 207 + 48).round()),
                get_position=["lng", "lat"],
                get_elevation="count",
                elevation_scale=40,
                radius=900,
                get_fill_color=["shade", "130", "220", 200],
                pickable=True,
                extruded=True,
            )
        else:
            layer = pdk.Layer(
                "HeatmapLayer",
                data=cells,
                get_position=["lng", "lat"],
                get_weight="count",
                radius_pixels=40,
            )

        st.pydeck_chart(
            pdk.Deck(
                layers=[layer],
                initial_view_state=pdk.ViewState(
                    latitude=36.5, longitude=127.8, zoom=6, pitch=40
                ),
                tooltip={"text": "충전기 {count}기"},
                map_style=BASEMAP,
            )
        )

def render_ranking(
    chargers: pd.DataFrame,
    base: pd.DataFrame,
    key: str,
    *,
    denominator: str,
    denominator_label: str,
    per: int,
    metric_label: str,
    region_unit: str,
    show_availability: bool = False,
    chart_top_n: int | None = None,
) -> None:
    """부족/접근성 랭킹을 그린다. 계산은 display.build_ranking_view 가 한다(테스트 가능).

    모집단(chargers)을 인자로 받는다 -- 전역 `filtered` 를 암묵 참조하면 이 함수가
    필터를 반영하는지 단위 테스트로 확인할 방법이 없어진다.
    """
    agg = aggregate_region(chargers.dropna(subset=[key]), key)
    view = build_ranking_view(
        base, agg, key, denominator=denominator, per=per, metric_label=metric_label
    )

    chart = view.head(chart_top_n) if chart_top_n else view
    if chart_top_n:
        st.markdown(f"**하위 {len(chart)} (취약)** — 아래 표는 전체 {len(view)}개 지역입니다.")
    st.bar_chart(chart.set_index("지역")[metric_label], height=380,
                 x_label=region_unit, y_label=metric_label)

    columns = {
        "지역": "지역",
        "charger_count": "충전기 수",
        denominator: denominator_label,
        metric_label: metric_label,
        "M3_fast_ratio": "급속 비율",
    }
    config = {
        metric_label: st.column_config.NumberColumn(format="%.1f"),
        # M3/M5 는 0~1 분수다. printf 의 "%%" 는 리터럴 퍼센트 기호일 뿐 100배를 하지 않아
        # 26.4% 가 "0.3%" 로 찍힌다. 스케일링은 "percent" 프리셋만 한다.
        "급속 비율": st.column_config.NumberColumn(format="percent"),
    }
    if show_availability:
        columns["M5_availability"] = "가용률"
        config["가용률"] = st.column_config.NumberColumn(format="percent")

    st.dataframe(
        view[list(columns)].rename(columns=columns),
        hide_index=True, use_container_width=True, column_config=config,
    )


# ---------------------------------------------------------------- 부족 지역 랭킹
with tab_shortage:
    st.subheader("전기차 대비 충전기 부족 " + unit_badge("시도"))
    st.caption(
        f"**M1 = 충전기 수 / (전기차 등록대수 / 1,000)** — 값이 낮을수록 부족합니다. "
        f"전기차 등록 데이터가 17개 시도 단위로만 제공되어 시군구로는 계산할 수 없습니다. "
        f"(전기차 기준일 {ev_date})"
    )

    render_ranking(
        filtered,
        sido_metrics[["zcode", "sido_full", "ev_count"]].rename(columns={"sido_full": "지역"}),
        key="zcode",
        denominator="ev_count",
        denominator_label="전기차 등록",
        per=1000,
        metric_label="EV1000대당 충전기",
        region_unit="시도",
        show_availability=True,
    )

# ---------------------------------------------------------------- 접근성 랭킹
with tab_access:
    # 해상도는 어떤 인구 파일이 있느냐로 정해진다. 시군구가 있으면 230개, 없으면 시도 17개.
    if sgg_metrics is not None:
        key, region_unit = "zscode", "시군구"
        base = sgg_metrics[["zscode", "sido", "sigungu", "population"]]
        base = base.assign(지역=base["sido"] + " " + base["sigungu"])
    elif "population" in sido_metrics.columns:
        key, region_unit = "zcode", "시도"
        base = sido_metrics[["zcode", "sido_full", "population"]].rename(
            columns={"sido_full": "지역"}
        )
    else:
        key, region_unit, base = None, None, None

    st.subheader("인구 대비 충전 인프라 접근성 " + unit_badge(region_unit or "시군구"))

    if base is None:
        st.warning(
            "**인구 데이터가 없어 이 지표를 계산할 수 없습니다.**\n\n"
            "https://jumin.mois.go.kr → 주민등록 인구 및 세대현황 → 월간에서 "
            "**2026년 06월 단월**, 등록구분 **거주자**로 CSV 를 받아 "
            "`data/raw/` 에 넣고 `python src/metrics.py` 를 다시 실행하세요.\n\n"
            "- 행정구역을 **시군구까지 펼치면** → `jumin_sgg_202606.csv` (230개, 고해상도)\n"
            "- 시도만 접어서 받으면 → `jumin_sido_202606.csv` (17개, 저해상도)"
        )
    else:
        st.caption(
            f"**M2 = 충전기 수 / (인구 / 100,000)** — 값이 낮을수록 접근성이 취약합니다. "
            f"현재 **{region_unit} 단위**로 계산됩니다."
        )
        if region_unit == "시도":
            st.info(
                "시도 인구 데이터로 계산 중입니다. **시군구 CSV** 를 `data/raw/jumin_sgg_202606.csv` 로 "
                "넣으면 랭킹이 230개 시군구로 올라갑니다."
            )

        render_ranking(
            filtered,
            base,
            key=key,
            denominator="population",
            denominator_label="인구",
            per=100_000,
            metric_label="인구10만명당 충전기",
            region_unit=region_unit,
            chart_top_n=min(20, len(base)),
        )
