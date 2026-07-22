import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS,
  SPEED,
  aggregateRegions,
  type Dataset,
  type Filters,
} from "./data";
import type { MetricSpec } from "./metrics";
import {
  RANK_SIZE,
  deriveMapMetric,
  deriveOperatorCounts,
  deriveRanking,
  deriveRecoverability,
  deriveStatusRows,
  describeActiveFilters,
} from "./selectors";

const metric = (
  id: string,
  denominator: MetricSpec["denominator"]["field"],
  scale: number,
  polarity: MetricSpec["polarity"] = "low_is_vulnerable",
): MetricSpec => ({
  id,
  label: id,
  unit: "단위",
  isRatio: false,
  numerator: { field: "charger_count", scale: 1 },
  denominator: { field: denominator, scale },
  decimals: 1,
  polarity,
  resolution: id === "M1" ? "sido" : "sigungu",
  definition: `${id} 정의`,
  caveat: null,
});

const dataset: Dataset = {
  meta: {
    schema_version: 1,
    snapshot_date: "2026-07-12",
    ev_date: "2025-12-31",
    population_date: "2026-06",
    population_label: "시군구",
    total_chargers: 35,
    invalid_coord_chargers: 0,
    grid_deg: 0.02,
    top_operators: ["기관 A", "기관 B"],
    station_overcount_max: 0,
  },
  metrics: [
    metric("M1", "ev_count", 1_000),
    metric("M2", "population", 100_000),
  ],
  operators: ["기관 A", "기관 B", "미진출 기관"],
  regions: [
    { zscode: 11010, zcode: 11, sido: "서울특별시", sigungu: "종로구", population: 100_000 },
    { zscode: 11020, zcode: 11, sido: "서울특별시", sigungu: "강남구", population: 200_000 },
    { zscode: 26010, zcode: 26, sido: "부산광역시", sigungu: "해운대구", population: 100_000 },
    { zscode: 46010, zcode: 46, sido: "전라남도", sigungu: "순천시", population: 100_000 },
  ],
  sidos: [
    { zcode: 11, name: "서울특별시", ev_count: 1_000, population: 300_000 },
    { zcode: 26, name: "부산광역시", ev_count: 1_000, population: 100_000 },
    { zcode: 46, name: "전라남도", ev_count: 2_000, population: 100_000 },
  ],
  regionCube: [
    [11010, 0, 0, 0, 20, 2, 10, 18, 9],
    [11020, 1, 0, 0, 10, 1, 0, 8, 4],
    [26010, 0, 0, 0, 5, 1, 5, 5, 2],
  ],
  statusCube: {
    labels: ["충전대기", "충전중", "상태미확인"],
    rows: [
      [11010, 0, 0, 0, 8, 10, 2],
      [11020, 1, 0, 0, 4, 5, 1],
      [26010, 0, 0, 0, 0, 5, 0],
    ],
  },
  gridCube: [],
};

function withDataset(overrides: Partial<Dataset>): Dataset {
  return { ...dataset, ...overrides };
}

function ranking(data: Dataset, filters: Filters, id: "M1" | "M2", rankSize = RANK_SIZE) {
  return deriveRanking(data, filters, aggregateRegions(data, filters), id, rankSize);
}

describe("deriveRanking M1", () => {
  it("시도 값을 취약한 순으로 정렬하고 요청한 최대 행 수로 자른다", () => {
    expect(ranking(dataset, EMPTY_FILTERS, "M1", 2)).toEqual([
      { name: "전라남도", value: 0, absent: false },
      { name: "부산광역시", value: 5, absent: false },
    ]);
  });

  it("zcode 범위만 남기고 운영기관 선택 시 0기인 시도만 미진출로 표시한다", () => {
    const scoped = { ...EMPTY_FILTERS, zcodes: [11], operators: [1] };

    expect(ranking(dataset, scoped, "M1")).toEqual([
      { name: "서울특별시", value: 10, absent: false },
    ]);
    expect(ranking(dataset, { ...EMPTY_FILTERS, operators: [1] }, "M1")).toEqual([
      { name: "부산광역시", value: 0, absent: true },
      { name: "전라남도", value: 0, absent: true },
      { name: "서울특별시", value: 10, absent: false },
    ]);
  });
});

describe("deriveRanking M2", () => {
  it("시군구 인구가 있으면 시군구 행을 만들고 오름차순으로 정렬한다", () => {
    expect(ranking(dataset, EMPTY_FILTERS, "M2")).toEqual([
      { name: "전남 순천시", value: 0, absent: false },
      { name: "서울 강남구", value: 5, absent: false },
      { name: "부산 해운대구", value: 5, absent: false },
      { name: "서울 종로구", value: 20, absent: false },
    ]);
  });

  it("선택 운영기관의 충전기가 0기인 시군구만 미진출로 표시한다", () => {
    expect(ranking(dataset, { ...EMPTY_FILTERS, operators: [1] }, "M2")).toEqual([
      { name: "서울 종로구", value: 0, absent: true },
      { name: "부산 해운대구", value: 0, absent: true },
      { name: "전남 순천시", value: 0, absent: true },
      { name: "서울 강남구", value: 5, absent: false },
    ]);
  });

  it("시군구 인구가 전혀 없으면 시도 인구로 강등해 빈 표를 내놓지 않는다", () => {
    const sidoPopulation = withDataset({
      regions: dataset.regions.map((region) => ({ ...region, population: null })),
    });

    expect(ranking(sidoPopulation, EMPTY_FILTERS, "M2")).toEqual([
      { name: "전라남도", value: 0, absent: false },
      { name: "부산광역시", value: 5, absent: false },
      { name: "서울특별시", value: 10, absent: false },
    ]);
  });
});

describe("deriveMapMetric", () => {
  const nationalTotals = new Map([
    [11010, { charger_count: 20 }],
    [11020, { charger_count: 10 }],
    [26010, { charger_count: 5 }],
    [46010, { charger_count: 0 }],
  ]);

  it("낮을수록 취약한 값을 전국 범위로 뒤집고 0과 고정 최댓값 사이로 제한한다", () => {
    const filteredTotals = new Map([
      [11010, { charger_count: 100 }],
      [11020, { charger_count: -10 }],
      [26010, { charger_count: 5 }],
    ]);

    expect(deriveMapMetric(dataset, filteredTotals, nationalTotals)).toEqual({
      regionValues: [
        { zscode: 11010, value: 100, vulnerability: 0 },
        { zscode: 11020, value: -5, vulnerability: 20 },
        { zscode: 26010, value: 5, vulnerability: 15 },
        { zscode: 46010, value: null, vulnerability: null },
      ],
      fixedVulnerabilityMax: 20,
    });
  });

  it("중립 극성이면 표시값은 유지하되 모든 취약도와 고정 최댓값을 비운다", () => {
    const neutral = withDataset({
      metrics: dataset.metrics.map((spec) => spec.id === "M2" ? { ...spec, polarity: "neutral" } : spec),
    });

    expect(deriveMapMetric(neutral, nationalTotals, nationalTotals)).toEqual({
      regionValues: [
        { zscode: 11010, value: 20, vulnerability: null },
        { zscode: 11020, value: 5, vulnerability: null },
        { zscode: 26010, value: 5, vulnerability: null },
        { zscode: 46010, value: 0, vulnerability: null },
      ],
      fixedVulnerabilityMax: undefined,
    });
  });

  it("필터 집계가 달라도 ADR 0001의 무필터 전국 고정 도메인은 바뀌지 않는다", () => {
    const filtered = new Map([[11010, { charger_count: 1 }]]);

    expect(deriveMapMetric(dataset, filtered, nationalTotals).fixedVulnerabilityMax).toBe(20);
    expect(deriveMapMetric(dataset, new Map(), nationalTotals).fixedVulnerabilityMax).toBe(20);
  });
});

describe("필터 파생 selector", () => {
  it("활성 조건의 표시 문구와 해당 조건만 해제한 칩 메타데이터를 만든다", () => {
    const filters: Filters = { zcodes: [46], operators: [1], speed: SPEED.FAST, only24h: true };

    expect(describeActiveFilters(dataset, filters)).toEqual({
      chips: [
        { key: "z46", label: "전라남도", relaxed: { ...filters, zcodes: [] } },
        { key: "speed", label: "급속만", relaxed: { ...filters, speed: SPEED.ALL } },
        { key: "o1", label: "기관 B", relaxed: { ...filters, operators: [] } },
        { key: "h24", label: "24시간 이용가능", relaxed: { ...filters, only24h: false } },
      ],
      emptyReasons: [
        "선택 지역: 전라남도",
        "선택 운영기관: 기관 B",
        "충전 속도: 급속만",
        "이용 시간: 24시간 이용가능만",
      ],
    });
  });

  it("한 차원만 완화했을 때 충전기가 생기는 경우에만 restored가 true다", () => {
    expect(deriveRecoverability(dataset, { ...EMPTY_FILTERS, operators: [2] })).toEqual([
      {
        key: "operator",
        label: "운영기관",
        relaxed: EMPTY_FILTERS,
        restored: true,
      },
    ]);
  });

  it("여러 원인이 겹쳐 단일 차원 완화로 복구되지 않는 조합을 모두 false로 남긴다", () => {
    const filters: Filters = { ...EMPTY_FILTERS, operators: [2], speed: SPEED.SLOW };

    expect(deriveRecoverability(dataset, filters)).toEqual([
      { key: "operator", label: "운영기관", relaxed: { ...filters, operators: [] }, restored: false },
      { key: "speed", label: "충전 속도", relaxed: { ...filters, speed: SPEED.ALL }, restored: false },
    ]);
  });
});

describe("단순 표시 집계 selector", () => {
  it("상태가 0인 행을 제외하고 개수 내림차순으로 정렬한다", () => {
    expect(deriveStatusRows(dataset, EMPTY_FILTERS)).toEqual([
      { label: "충전중", count: 20 },
      { label: "충전대기", count: 12 },
      { label: "상태미확인", count: 3 },
    ]);
  });

  it("무필터 큐브 행만 사용해 운영기관별 충전기 수를 합산한다", () => {
    expect(deriveOperatorCounts(dataset)).toEqual(new Map([
      [0, 25],
      [1, 10],
    ]));
  });
});
