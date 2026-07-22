import { describe, expect, it } from "vitest";

import { EMPTY_FILTERS, SPEED } from "./data";
import {
  DEFAULT_RANK_METRIC_ID,
  DEFAULT_VIEW,
  parseFilterQuery,
  serializeFilterQuery,
  type UrlStateDataset,
} from "./urlState";

const dataset: UrlStateDataset = {
  operators: ["환경부", "A&B / 충전(주)?", "기관, 쉼표"],
  sidos: [
    { zcode: 11 },
    { zcode: 26 },
  ],
};

describe("URL 분석 상태", () => {
  it("한글·특수문자 운영기관 이름을 포함한 필터와 분석 토글을 왕복 보존한다", () => {
    const filters = {
      zcodes: [26, 11],
      operators: [1, 2],
      speed: SPEED.SLOW,
      only24h: true,
    };

    const query = serializeFilterQuery(filters, "heat", "M1", dataset);

    expect(new URLSearchParams(query).get("op")).toBe(
      JSON.stringify(["A&B / 충전(주)?", "기관, 쉼표"]),
    );
    expect(parseFilterQuery(query, dataset)).toEqual({
      filters,
      view: "heat",
      rankMetricId: "M1",
    });
  });

  it("운영기관 순서가 바뀐 데이터에서도 이름을 현재 인덱스로 다시 매핑한다", () => {
    const query = serializeFilterQuery(
      { ...EMPTY_FILTERS, operators: [1] },
      DEFAULT_VIEW,
      DEFAULT_RANK_METRIC_ID,
      dataset,
    );
    const regenerated = {
      ...dataset,
      operators: ["A&B / 충전(주)?", "환경부", "기관, 쉼표"],
    };

    expect(parseFilterQuery(query, regenerated).filters.operators).toEqual([0]);
  });

  it("일부 기본값을 섞은 급속·단일 지역 조합도 왕복 보존한다", () => {
    const filters = {
      zcodes: [11],
      operators: [0],
      speed: SPEED.FAST,
      only24h: false,
    };

    expect(parseFilterQuery(serializeFilterQuery(filters, "bubble", "M2", dataset), dataset)).toEqual({
      filters,
      view: "bubble",
      rankMetricId: "M2",
    });
  });

  it("모든 상태가 기본값이면 빈 쿼리를 만든다", () => {
    expect(
      serializeFilterQuery(EMPTY_FILTERS, DEFAULT_VIEW, DEFAULT_RANK_METRIC_ID, dataset),
    ).toBe("");
  });

  it("빈 쿼리를 기본 상태로 읽는다", () => {
    expect(parseFilterQuery("", dataset)).toEqual({
      filters: EMPTY_FILTERS,
      view: DEFAULT_VIEW,
      rankMetricId: DEFAULT_RANK_METRIC_ID,
    });
  });

  it("형식이 잘못된 지역 숫자가 하나라도 있으면 지역 필터만 기본값으로 강등한다", () => {
    const parsed = parseFilterQuery("?z=11,2x&speed=fast", dataset);

    expect(parsed.filters.zcodes).toEqual([]);
    expect(parsed.filters.speed).toBe(SPEED.FAST);
  });

  it("현재 데이터에 없는 지역 코드는 버리고 존재하는 코드만 유지한다", () => {
    expect(parseFilterQuery("?z=11,999,26", dataset).filters.zcodes).toEqual([11, 26]);
  });

  it("알 수 없는 속도 토큰은 전체 속도로 강등한다", () => {
    expect(parseFilterQuery("?speed=turbo", dataset).filters.speed).toBe(SPEED.ALL);
  });

  it("같은 키가 중복되면 해당 차원만 기본값으로 강등한다", () => {
    const parsed = parseFilterQuery(
      "?z=11&z=26&op=%5B%22%ED%99%98%EA%B2%BD%EB%B6%80%22%5D&op=%5B%22A%26B%22%5D" +
        "&speed=fast&speed=slow&h24=1&h24=1&view=heat&view=grid&metric=M1&metric=M2",
      dataset,
    );

    expect(parsed.filters).toEqual(EMPTY_FILTERS);
    expect(parsed.view).toBe(DEFAULT_VIEW);
    expect(parsed.rankMetricId).toBe(DEFAULT_RANK_METRIC_ID);
  });

  it("사라진 운영기관 이름은 버리고 현재 데이터에 남은 이름만 인덱스로 바꾼다", () => {
    const params = new URLSearchParams();
    params.set("op", JSON.stringify(["환경부", "사라진 기관"]));

    expect(parseFilterQuery(params.toString(), dataset).filters.operators).toEqual([0]);
  });

  it("잘못된 운영기관 배열은 전체 운영기관으로 강등한다", () => {
    expect(
      parseFilterQuery("?op=%5B%22%ED%99%98%EA%B2%BD%EB%B6%80%22%2C1%5D", dataset).filters
        .operators,
    ).toEqual([]);
    expect(parseFilterQuery("?op=%E0%A4%A", dataset).filters.operators).toEqual([]);
  });

  it("알 수 없는 지도·지표 토큰은 각 기본 토글로 강등한다", () => {
    const parsed = parseFilterQuery("?view=terrain&metric=M9", dataset);

    expect(parsed.view).toBe(DEFAULT_VIEW);
    expect(parsed.rankMetricId).toBe(DEFAULT_RANK_METRIC_ID);
  });

  it("알 수 없거나 중복된 24시간 플래그는 해제 상태로 강등한다", () => {
    expect(parseFilterQuery("?h24=yes", dataset).filters.only24h).toBe(false);
    expect(parseFilterQuery("?h24=1&h24=1", dataset).filters.only24h).toBe(false);
  });
});
