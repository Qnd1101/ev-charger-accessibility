"""M1~M5 지표 정의의 **유일한 원본**.

`AGENTS.md`: "지표 정의는 Python 데이터 파이프라인을 유일한 원본으로 유지하고 UI에서
재구현하지 않는다." 그런데 화면의 필터는 동적이라 비율을 미리 계산해 둘 수 없다 --
급속 비율은 운영기관을 고를 때마다 달라진다. 즉 **나눗셈은 질의 시점에** 일어나야 한다.

그래서 공식을 코드가 아니라 **데이터**로 둔다. 다섯 지표가 전부 같은 모양이기 때문에
가능하다:

    지표 = 분자(합산 가능한 수) / (분모(합산 가능한 수) / 배율)

    M1 = charger_count    / (ev_count   / 1,000)
    M2 = charger_count    / (population / 100,000)
    M3 = fast_count       / charger_count
    M4 = charger_count    / station_count
    M5 = available_count  / live_count

분자와 분모는 **둘 다 더할 수 있는 수**이고 나눗셈만 마지막에 온다. 따라서 이 표를 JSON
으로 내보내면 화면은 공식 다섯 개가 아니라 **평가기 하나**만 있으면 된다. 지표를 추가할 때
TypeScript 는 손대지 않는다.

Python 도 이 표에서 파생 열을 만든다(`apply_metrics`). 두 벌의 정의가 존재할 여지를
남기지 않는 것이 이 모듈의 존재 이유다.
"""

from __future__ import annotations

from dataclasses import dataclass

# 합산 가능한 카운트. 집계 테이블의 열 이름이자 화면 큐브의 필드 이름이다.
COUNT_FIELDS = (
    "charger_count",
    "station_count",
    "fast_count",
    "live_count",
    "available_count",
)

# 지역에 붙는 정적 속성. 큐브가 아니라 `regions.json` / `sidos[]` 에서 온다.
REGION_FIELDS = ("population", "ev_count")


@dataclass(frozen=True)
class Term:
    """지표의 분자 또는 분모. 언제나 **합산 가능한 수 하나**를 가리킨다.

    `scale` 은 "EV 1,000대당", "인구 10만명당" 처럼 분모를 사람이 읽는 단위로 환산한다.
    값은 `field / scale` 이다.
    """

    field: str
    scale: float = 1.0

    def __post_init__(self) -> None:
        if self.field not in COUNT_FIELDS + REGION_FIELDS:
            raise ValueError(f"알 수 없는 항: {self.field}")


@dataclass(frozen=True)
class MetricSpec:
    id: str
    column: str  # 산출물 parquet 의 열 이름
    label: str
    unit: str
    numerator: Term
    denominator: Term
    decimals: int
    # 취약 방향. 색 방향·랭킹 정렬·3D 높이 방향이 전부 여기서 파생된다.
    # 한 곳에 고정하지 않으면 같은 지표가 화면마다 다른 색을 갖는다(DESIGN.md 48행).
    polarity: str  # "low_is_vulnerable" | "high_is_vulnerable" | "neutral"
    resolution: str  # "sido" | "sigungu" -- 해상도를 화면 배지가 밝혀야 한다
    definition: str  # 툴팁에 그대로 쓰는 한 줄 정의
    caveat: str | None = None  # 해석 주의사항. 없으면 None.

    @property
    def is_ratio(self) -> bool:
        """0~1 비율인가(단위가 %). 화면이 100을 곱할지 판단한다."""
        return self.unit == "%"


METRICS: tuple[MetricSpec, ...] = (
    MetricSpec(
        id="M1",
        column="M1_chargers_per_1k_ev",
        label="EV 1,000대당 충전기",
        unit="기/EV1000대",
        numerator=Term("charger_count"),
        denominator=Term("ev_count", scale=1_000),
        decimals=1,
        polarity="low_is_vulnerable",
        resolution="sido",
        definition="전기차 등록 대수 대비 충전기 수. 낮을수록 수요 대비 공급이 부족하다.",
        caveat="한전 전기차 통계가 시도 단위로만 제공되어 M1 의 해상도는 시도다.",
    ),
    MetricSpec(
        id="M2",
        column="M2_chargers_per_100k_pop",
        label="인구 10만명당 충전기",
        unit="기/인구10만",
        numerator=Term("charger_count"),
        denominator=Term("population", scale=100_000),
        decimals=1,
        polarity="low_is_vulnerable",
        resolution="sigungu",
        definition="주민등록 인구 대비 충전기 수. 낮을수록 접근성이 취약하다.",
        caveat="주민등록 인구가 없는 시군구는 순위에서 제외된다.",
    ),
    MetricSpec(
        id="M3",
        column="M3_fast_ratio",
        label="급속 비율",
        unit="%",
        numerator=Term("fast_count"),
        denominator=Term("charger_count"),
        decimals=1,
        polarity="neutral",
        resolution="sigungu",
        definition="전체 충전기 중 급속충전기 비율.",
    ),
    MetricSpec(
        id="M4",
        column="M4_chargers_per_station",
        label="충전소당 충전기",
        unit="기/충전소",
        numerator=Term("charger_count"),
        denominator=Term("station_count"),
        decimals=1,
        polarity="neutral",
        resolution="sigungu",
        definition="충전소 한 곳에 설치된 평균 충전기 수.",
        # 충전소 수는 지역·운영기관 방향으로 합산되지 않는다. 한 충전소가 여러 조합에
        # 걸치면 중복 계상된다(상한 = meta.station_overcount_max). 그만큼 M4 가 낮게 나온다.
        caveat="여러 지역·운영기관을 함께 고르면 충전소가 중복 계상되어 값이 낮게 나올 수 있다.",
    ),
    MetricSpec(
        id="M5",
        column="M5_availability",
        label="유휴율",
        unit="%",
        numerator=Term("available_count"),
        denominator=Term("live_count"),
        decimals=1,
        polarity="neutral",
        resolution="sigungu",
        # 이름이 "가용률"이 아닌 이유는 metrics.py 의 STAT_* 주석 참고.
        definition="응답하는 충전기(충전대기·충전중) 중 지금 비어 있는 비율. 스냅샷 시점 값이다.",
        caveat="통신이상·상태미확인·운영중지·점검중 충전기는 분모에서 제외된다. '가용률'이 아니다.",
    ),
)


def to_json() -> list[dict]:
    """화면이 읽는 형태. 필드 이름은 큐브·regions.json 의 이름과 같아야 한다."""
    return [
        {
            "id": m.id,
            "label": m.label,
            "unit": m.unit,
            "isRatio": m.is_ratio,
            "numerator": {"field": m.numerator.field, "scale": m.numerator.scale},
            "denominator": {"field": m.denominator.field, "scale": m.denominator.scale},
            "decimals": m.decimals,
            "polarity": m.polarity,
            "resolution": m.resolution,
            "definition": m.definition,
            "caveat": m.caveat,
        }
        for m in METRICS
    ]


def apply_metrics(df, specs: tuple[MetricSpec, ...] = METRICS):
    """`df` 가 가진 항으로 계산 가능한 지표만 파생 열로 붙인다.

    어떤 지표를 어느 단계에서 붙일지 호출자가 고르지 않는다 -- 필요한 항이 프레임에
    있으면 붙고, 없으면 건너뛴다. 그래서 `aggregate_region` 은 M3/M4/M5 를,
    한전 EV 를 조인한 뒤에는 M1 이, 인구를 조인한 뒤에는 M2 가 자동으로 생긴다.
    """
    for m in specs:
        if m.numerator.field not in df.columns or m.denominator.field not in df.columns:
            continue
        den = df[m.denominator.field] / m.denominator.scale
        num = df[m.numerator.field] / m.numerator.scale
        # 분모 0 은 NaN 이다. inf 를 남기면 랭킹 최상위를 조용히 차지한다.
        df[m.column] = (num / den).where(den > 0)
    return df
