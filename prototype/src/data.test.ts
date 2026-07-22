import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS,
  SPEED,
  aggregateGrid,
  aggregateRegions,
  aggregateStatusDistribution,
  totalTerms,
  type Dataset,
  type Filters,
} from "./data";
import { evaluate, type MetricSpec } from "./metrics";

const dataset: Dataset = {
  meta: {
    schema_version: 1,
    snapshot_date: "2026-07-12",
    ev_date: "2025-12-31",
    population_date: "2026-06",
    population_label: "시군구",
    total_chargers: 5,
    invalid_coord_chargers: 0,
    grid_deg: 0.02,
    top_operators: ["기관 A", "기관 B"],
    station_overcount_max: 0,
  },
  metrics: [],
  operators: ["기관 A", "기관 B"],
  regions: [
    { zscode: 11010, zcode: 11, sido: "서울특별시", sigungu: "급속구", population: 100_000 },
    { zscode: 11020, zcode: 11, sido: "서울특별시", sigungu: "완속구", population: 200_000 },
    { zscode: 26010, zcode: 26, sido: "부산광역시", sigungu: "무충전구", population: 300_000 },
  ],
  sidos: [
    { zcode: 11, name: "서울특별시", ev_count: 1_000, population: null },
    { zcode: 26, name: "부산광역시", ev_count: 2_000, population: null },
  ],
  regionCube: [
    [11010, 0, 0, 0, 2, 1, 2, 2, 2],
    [11010, 0, 1, 0, 2, 1, 2, 2, 2],
    [11010, 0, 0, 1, 2, 1, 2, 2, 2],
    [11010, 0, 1, 1, 2, 1, 2, 2, 2],
    [11020, 1, 0, 0, 3, 1, 0, 3, 3],
    [11020, 1, 2, 0, 3, 1, 0, 3, 3],
  ],
  statusCube: { labels: [], rows: [] },
  gridCube: [],
};

function terms(filters: Filters, data = dataset) {
  return totalTerms(data, filters, aggregateRegions(data, filters));
}

function withDataset(overrides: Partial<Dataset>): Dataset {
  return { ...dataset, ...overrides };
}

const populationMetric: MetricSpec = {
  id: "M2",
  label: "인구 10만명당 충전기",
  unit: "기/인구10만",
  isRatio: false,
  numerator: { field: "charger_count", scale: 1 },
  denominator: { field: "population", scale: 100_000 },
  decimals: 1,
  polarity: "low_is_vulnerable",
  resolution: "sigungu",
  definition: "주민등록 인구 대비 충전기 수. 낮을수록 접근성이 취약하다.",
  caveat: "주민등록 인구가 없는 시군구는 순위에서 제외된다.",
};

describe("aggregateRegions 희소 집계", () => {
  it.each([
    ["속도", { ...EMPTY_FILTERS, speed: SPEED.SLOW }, 11010],
    ["운영기관", { ...EMPTY_FILTERS, operators: [1] }, 11010],
    ["24시간", { ...EMPTY_FILTERS, only24h: true }, 11020],
  ])("%s 필터로 제외된 지역은 0값 엔트리를 만들지 않는다", (_name, filters, excludedZscode) => {
    expect(aggregateRegions(dataset, filters).has(excludedZscode)).toBe(false);
  });

  it("전체에는 있던 지역이 선택 운영기관에 충전기가 없으면 미진출을 뜻하는 누락 상태가 된다", () => {
    expect(aggregateRegions(dataset, EMPTY_FILTERS).has(11010)).toBe(true);
    expect(aggregateRegions(dataset, { ...EMPTY_FILTERS, operators: [1] }).has(11010)).toBe(false);
  });

  it("같은 시군구의 여러 큐브 행에서 다섯 카운트를 모두 누적한다", () => {
    const multiRowDataset = withDataset({
      regionCube: [
        [11010, 0, 0, 0, 2, 1, 2, 2, 1],
        [11010, 1, 0, 0, 3, 2, 1, 1, 1],
      ],
    });

    expect(aggregateRegions(multiRowDataset, EMPTY_FILTERS).get(11010)).toEqual({
      charger_count: 5,
      station_count: 3,
      fast_count: 3,
      live_count: 3,
      available_count: 2,
    });
  });

  it("입력 데이터셋을 변경하지 않는다", () => {
    const before = structuredClone(dataset);

    aggregateRegions(dataset, { ...EMPTY_FILTERS, zcodes: [11], operators: [0], only24h: true });

    expect(dataset).toEqual(before);
  });
});

describe("totalTerms 인구 분모", () => {
  it.each([
    ["속도", { ...EMPTY_FILTERS, speed: SPEED.FAST }],
    ["운영기관", { ...EMPTY_FILTERS, operators: [0] }],
    ["24시간", { ...EMPTY_FILTERS, only24h: true }],
  ])("%s 필터는 전국 지리 범위의 인구를 줄이지 않는다", (_name, filters) => {
    expect(terms(filters).population).toBe(600_000);
  });

  it("EMPTY_FILTERS는 큐브 행이 없는 지역의 인구도 포함한다", () => {
    expect(terms(EMPTY_FILTERS).population).toBe(600_000);
  });

  it("시도 필터만 인구 분모의 지리 범위를 제한한다", () => {
    expect(terms({ ...EMPTY_FILTERS, zcodes: [11], speed: SPEED.FAST }).population).toBe(300_000);
  });

  it("시군구 인구가 없으면 시도 인구로 폴백하고 같은 지리 범위를 적용한다", () => {
    const sidoPopulation: Dataset = {
      ...dataset,
      regions: dataset.regions.map((region) => ({ ...region, population: null })),
      sidos: [
        { ...dataset.sidos[0], population: 300_000 },
        { ...dataset.sidos[1], population: 300_000 },
      ],
    };

    expect(terms({ ...EMPTY_FILTERS, speed: SPEED.FAST }, sidoPopulation).population).toBe(600_000);
    expect(terms({ ...EMPTY_FILTERS, zcodes: [11], speed: SPEED.FAST }, sidoPopulation).population).toBe(300_000);
  });

  it("EV 등록 대수는 충전기 필터가 아니라 선택한 시도 범위만 따른다", () => {
    expect(terms({ ...EMPTY_FILTERS, speed: SPEED.FAST, operators: [1], only24h: true }).ev_count).toBe(
      3_000,
    );
    expect(
      terms({ ...EMPTY_FILTERS, zcodes: [11], speed: SPEED.FAST, operators: [1], only24h: true }).ev_count,
    ).toBe(1_000);
  });

  it.each([
    ["범위 내 EV 등록 대수가 0일 때", withDataset({ sidos: [{ ...dataset.sidos[0], ev_count: 0 }] }), [11]],
    ["범위에 시도 행이 없을 때", dataset, [99]],
  ])("%s ev_count 항을 생략한다", (_name, data, zcodes) => {
    expect(terms({ ...EMPTY_FILTERS, zcodes }, data).ev_count).toBeUndefined();
  });

  it("어느 해상도에도 인구가 없으면 항을 생략해 M2 평가가 null이 된다", () => {
    const noPopulationData = withDataset({
      regions: dataset.regions.map((region) => ({ ...region, population: null })),
      sidos: dataset.sidos.map((sido) => ({ ...sido, population: null })),
    });

    const totals = terms(EMPTY_FILTERS, noPopulationData);

    expect(totals.population).toBeUndefined();
    expect(evaluate(populationMetric, totals)).toBeNull();
  });
});

describe("aggregateGrid 격자 집계", () => {
  const gridDataset = withDataset({
    gridCube: [
      [35000, 127000, 11, 0, 1, 1, 2],
      [35000, 127000, 26, 1, 0, 0, 3],
      [35100, 128000, 11, 1, 0, 1, 4],
      [35200, 129000, 26, 0, 1, 0, 5],
    ],
  });

  it("운영기관과 시도가 다른 같은 좌표 행을 한 셀로 합산한다", () => {
    const cells = aggregateGrid(gridDataset, EMPTY_FILTERS);

    expect(cells).toHaveLength(3);
    expect(cells.find((cell) => cell.lat === 35 && cell.lng === 127)).toEqual({
      lat: 35,
      lng: 127,
      count: 5,
    });
  });

  it("급속과 완속 필터를 각 행의 속도 구분에 적용한다", () => {
    expect(aggregateGrid(gridDataset, { ...EMPTY_FILTERS, speed: SPEED.FAST })).toEqual([
      { lat: 35, lng: 127, count: 2 },
      { lat: 35.2, lng: 129, count: 5 },
    ]);
    expect(aggregateGrid(gridDataset, { ...EMPTY_FILTERS, speed: SPEED.SLOW })).toEqual([
      { lat: 35, lng: 127, count: 3 },
      { lat: 35.1, lng: 128, count: 4 },
    ]);
  });

  it("24시간 필터는 24시간 행만 남긴다", () => {
    expect(aggregateGrid(gridDataset, { ...EMPTY_FILTERS, only24h: true })).toEqual([
      { lat: 35, lng: 127, count: 2 },
      { lat: 35.1, lng: 128, count: 4 },
    ]);
  });

  it("시도 필터는 선택한 zcode 행만 합산한다", () => {
    expect(aggregateGrid(gridDataset, { ...EMPTY_FILTERS, zcodes: [11] })).toEqual([
      { lat: 35, lng: 127, count: 2 },
      { lat: 35.1, lng: 128, count: 4 },
    ]);
  });

  it("한국 좌표의 서로 다른 셀은 숫자 키에서 충돌하지 않는다", () => {
    const koreanCells = withDataset({
      gridCube: [
        [35000, 127000, 11, 0, 1, 1, 2],
        [35001, 127001, 11, 0, 1, 1, 3],
      ],
    });

    expect(aggregateGrid(koreanCells, EMPTY_FILTERS)).toHaveLength(2);
  });

  it("키 배수 1e6의 경계를 고정해 1e5라면 충돌할 두 셀을 분리한다", () => {
    // 인코딩 전제: 0 <= lngE3 < 1e6. 두 번째 좌표는 1e5 배수라면 첫 셀과
    // 같은 키가 되는 합성 경계 탐침이며, 1e6 배수에서는 별도 셀이어야 한다.
    const collisionProbe = withDataset({
      gridCube: [
        [35000, 127000, 11, 0, 1, 1, 2],
        [35001, 27000, 11, 0, 1, 1, 3],
      ],
    });

    expect(aggregateGrid(collisionProbe, EMPTY_FILTERS)).toEqual([
      { lat: 35, lng: 127, count: 2 },
      { lat: 35.001, lng: 27, count: 3 },
    ]);
  });
});

describe("aggregateStatusDistribution 상태 분포", () => {
  it("라벨 순서대로 합산하며 같은 필터의 지역 충전기 합계와 일치한다", () => {
    const statusDataset = withDataset({
      regionCube: [
        [11010, 0, 0, 0, 5, 2, 2, 3, 2],
        [11010, 1, 0, 0, 3, 1, 1, 2, 1],
        [11020, 1, 0, 0, 4, 2, 0, 3, 1],
        [11010, 0, 1, 0, 2, 1, 2, 2, 1],
      ],
      statusCube: {
        labels: ["충전대기", "충전중", "기타"],
        rows: [
          [11010, 0, 0, 0, 2, 1, 2],
          [11010, 1, 0, 0, 1, 2, 0],
          [11020, 1, 0, 0, 0, 1, 3],
          [11010, 0, 1, 0, 1, 1, 0],
        ],
      },
    });
    const filters = { ...EMPTY_FILTERS, zcodes: [11] };

    const distribution = aggregateStatusDistribution(statusDataset, filters);
    const chargerTotal = [...aggregateRegions(statusDataset, filters).values()].reduce(
      (sum, value) => sum + (value.charger_count ?? 0),
      0,
    );

    expect(distribution).toEqual([3, 4, 5]);
    expect(distribution.reduce((sum, count) => sum + count, 0)).toBe(chargerTotal);
  });
});
