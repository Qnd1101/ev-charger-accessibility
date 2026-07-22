import { describe, expect, it } from "vitest";

import { validateDatasetFiles } from "./contract";

function validFiles() {
  return {
    meta: {
      schema_version: 1,
      snapshot_date: "2026-07-12",
      ev_date: "2025-12-31",
      population_date: "2026-06",
      population_label: "시군구",
      total_chargers: 5,
      invalid_coord_chargers: 0,
      grid_deg: 0.02,
      top_operators: ["기관 A"],
      station_overcount_max: 0,
      unplaced_chargers: 0,
    },
    metrics: [
      {
        id: "M1",
        label: "EV 1,000대당 충전기",
        unit: "기/EV1000대",
        isRatio: false,
        numerator: { field: "charger_count", scale: 1 },
        denominator: { field: "ev_count", scale: 1000 },
        polarity: "low_is_vulnerable",
        decimals: 1,
        resolution: "sido",
        definition: "EV 등록대수 대비 충전기 수",
        caveat: null,
      },
    ],
    operators: ["기관 A"],
    regions: {
      regions: [
        { zscode: 11110, zcode: 11, sido: "서울특별시", sigungu: "종로구", population: 100_000 },
      ],
      sidos: [{ zcode: 11, name: "서울특별시", ev_count: 1_000, population: null }],
    },
    regionCube: [[11110, 0, 0, 0, 5, 3, 2, 5, 3]],
    statusCube: { labels: ["충전대기", "충전중"], rows: [[11110, 0, 0, 0, 3, 2]] },
    gridCube: [[37500, 127000, 11, 0, 1, 1, 5]],
  };
}

describe("정적 데이터 계약", () => {
  it("지원하는 정상 payload를 Dataset으로 반환한다", () => {
    const files = validFiles();

    expect(validateDatasetFiles(files)).toEqual({
      meta: files.meta,
      metrics: files.metrics,
      operators: files.operators,
      regions: files.regions.regions,
      sidos: files.regions.sidos,
      regionCube: files.regionCube,
      statusCube: files.statusCube,
      gridCube: files.gridCube,
    });
  });

  it.each([
    ["누락", undefined],
    ["불일치", 2],
  ])("schema_version %s를 재생성 안내와 함께 거부한다", (_case, schemaVersion) => {
    const files = validFiles();
    const { schema_version: _schemaVersion, ...metaWithoutVersion } = files.meta;
    const meta = schemaVersion === undefined ? metaWithoutVersion : { ...files.meta, schema_version: schemaVersion };

    expect(() => validateDatasetFiles({ ...files, meta })).toThrow(
      /meta\.json.*schema_version.*기대: 1.*실제: (없음|2).*서로 다른 스키마 버전.*python scripts\/build_web_data\.py/,
    );
  });

  it.each([
    {
      caseName: "8개 요소 행",
      row: [11110, 0, 0, 0, 5, 3, 2, 5],
      message: /region_cube\.json.*0번 행.*기대: 길이 9.*실제: 길이 8/,
    },
    {
      caseName: "문자열 요소 행",
      row: [11110, 0, 0, 0, "5", 3, 2, 5, 3],
      message: /region_cube\.json.*0번 행.*4번 요소.*기대: number.*실제: string/,
    },
  ])("regionCube의 $caseName을 행 위치와 함께 거부한다", ({ row, message }) => {
    const files = validFiles();

    expect(() => validateDatasetFiles({ ...files, regionCube: [row] })).toThrow(message);
  });

  it("gridCube의 잘못된 행 길이를 거부한다", () => {
    const files = validFiles();

    expect(() => validateDatasetFiles({ ...files, gridCube: [[37500, 127000, 11, 0, 1, 1]] })).toThrow(
      /grid_cube\.json.*0번 행.*기대: 길이 7.*실제: 길이 6/,
    );
  });

  it("statusCube 행 길이가 labels 수와 맞지 않으면 거부한다", () => {
    const files = validFiles();
    const statusCube = { labels: ["충전대기", "충전중"], rows: [[11110, 0, 0, 0, 5]] };

    expect(() => validateDatasetFiles({ ...files, statusCube })).toThrow(
      /status_cube\.json.*0번 행.*기대: 길이 6.*실제: 길이 5/,
    );
  });

  it("meta 필수 키가 없으면 파일과 키를 밝혀 거부한다", () => {
    const files = validFiles();
    const { total_chargers: _totalChargers, ...meta } = files.meta;

    expect(() => validateDatasetFiles({ ...files, meta })).toThrow(
      /meta\.json.*total_chargers.*기대: number.*실제: 없음.*python scripts\/build_web_data\.py/,
    );
  });

  it("metrics의 중첩 필수 키 타입이 잘못되면 항목과 키를 밝혀 거부한다", () => {
    const files = validFiles();
    const metric = files.metrics[0];
    const metrics = [{ ...metric, denominator: { ...metric.denominator, scale: "1000" } }];

    expect(() => validateDatasetFiles({ ...files, metrics })).toThrow(
      /metrics\.json.*0번 항목.*denominator\.scale.*기대: number.*실제: string/,
    );
  });

  it("Dataset이 사용하는 metrics 표시 필드가 없으면 거부한다", () => {
    const files = validFiles();
    const { isRatio: _isRatio, ...metric } = files.metrics[0];

    expect(() => validateDatasetFiles({ ...files, metrics: [metric] })).toThrow(
      /metrics\.json.*0번 항목.*isRatio.*기대: boolean.*실제: 없음/,
    );
  });

  it("meta의 nullable 필드도 허용된 primitive 타입만 받는다", () => {
    const files = validFiles();
    const meta = { ...files.meta, population_date: 202606 };

    expect(() => validateDatasetFiles({ ...files, meta })).toThrow(
      /meta\.json.*population_date.*기대: string\|null.*실제: number/,
    );
  });

  it.each([
    {
      caseName: "region 필드",
      regions: {
        regions: [{ zscode: 11110, zcode: 11, sido: "서울특별시", sigungu: 123, population: 100_000 }],
        sidos: [{ zcode: 11, name: "서울특별시", ev_count: 1_000, population: null }],
      },
      message: /regions\.json.*regions\[0\]\.sigungu.*기대: string.*실제: number/,
    },
    {
      caseName: "sido 필드",
      regions: {
        regions: [
          { zscode: 11110, zcode: 11, sido: "서울특별시", sigungu: "종로구", population: 100_000 },
        ],
        sidos: [{ zcode: 11, name: "서울특별시", ev_count: "1000", population: null }],
      },
      message: /regions\.json.*sidos\[0\]\.ev_count.*기대: number.*실제: string/,
    },
  ])("regions.json의 잘못된 $caseName 타입을 거부한다", ({ regions, message }) => {
    const files = validFiles();

    expect(() => validateDatasetFiles({ ...files, regions })).toThrow(message);
  });

  it("operators의 문자열 아닌 요소를 거부한다", () => {
    const files = validFiles();

    expect(() => validateDatasetFiles({ ...files, operators: ["기관 A", 2] })).toThrow(
      /operators\.json.*1번 요소.*기대: string.*실제: number/,
    );
  });
});
