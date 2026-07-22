import { describe, expect, it } from "vitest";

import { byId, evaluate, format, isVulnerableFirst, type MetricSpec } from "./metrics";

const M1: MetricSpec = {
  id: "M1",
  label: "EV 1,000대당 충전기",
  unit: "기/EV1000대",
  isRatio: false,
  numerator: { field: "charger_count", scale: 1 },
  denominator: { field: "ev_count", scale: 1_000 },
  decimals: 1,
  polarity: "low_is_vulnerable",
  resolution: "sido",
  definition: "전기차 등록 대수 대비 충전기 수. 낮을수록 수요 대비 공급이 부족하다.",
  caveat: "한전 전기차 통계가 시도 단위로만 제공되어 M1 의 해상도는 시도다.",
};

const M2: MetricSpec = {
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

const M3: MetricSpec = {
  id: "M3",
  label: "급속 비율",
  unit: "%",
  isRatio: true,
  numerator: { field: "fast_count", scale: 1 },
  denominator: { field: "charger_count", scale: 1 },
  decimals: 1,
  polarity: "neutral",
  resolution: "sigungu",
  definition: "전체 충전기 중 급속충전기 비율.",
  caveat: null,
};

describe("evaluate 지표 평가", () => {
  it("분모가 0이면 Infinity 대신 null을 반환한다", () => {
    expect(evaluate(M3, { fast_count: 10, charger_count: 0 })).toBeNull();
  });

  it.each([
    ["분자", { charger_count: 100_000 }],
    ["분모", { fast_count: 50 }],
  ])("%s 항이 없으면 null을 반환한다", (_name, terms) => {
    expect(evaluate(M3, terms)).toBeNull();
  });

  it("EV 1,000대와 인구 10만명 분모 스케일을 적용한다", () => {
    expect(evaluate(M1, { charger_count: 250, ev_count: 50_000 })).toBe(5);
    expect(evaluate(M2, { charger_count: 250, population: 500_000 })).toBe(50);
  });

  it("분자 스케일을 나눗셈에 적용한다", () => {
    const chargersInTens: MetricSpec = {
      ...M2,
      id: "M2_TENS",
      label: "인구 10만명당 충전기 10기 단위",
      numerator: { field: "charger_count", scale: 10 },
    };

    expect(evaluate(chargersInTens, { charger_count: 250, population: 500_000 })).toBe(5);
  });
});

describe("format 지표 표시", () => {
  it("null은 대시로 표시한다", () => {
    expect(format(M2, null)).toBe("—");
  });

  it("비율은 100을 곱한 뒤 소수 자릿수에 맞춰 표시한다", () => {
    expect(format(M3, 0.456)).toBe("45.6");
  });

  it("decimals를 최소·최대 소수 자릿수로 적용한다", () => {
    expect(format(M2, 12)).toBe("12.0");
    expect(format(M2, 12.36)).toBe("12.4");
  });

  it("비율이 아닌 값은 ko-KR 천 단위 구분자를 사용한다", () => {
    expect(format(M2, 12_345.6)).toBe("12,345.6");
  });
});

describe("isVulnerableFirst 취약 방향", () => {
  it("low_is_vulnerable일 때만 true를 반환한다", () => {
    const highIsVulnerable: MetricSpec = { ...M3, polarity: "high_is_vulnerable" };

    expect(isVulnerableFirst(M1)).toBe(true);
    expect(isVulnerableFirst(M3)).toBe(false);
    expect(isVulnerableFirst(highIsVulnerable)).toBe(false);
  });
});

describe("byId 지표 조회", () => {
  it("id가 일치하는 지표 정의를 반환한다", () => {
    expect(byId([M1, M2, M3], "M2")).toBe(M2);
  });

  it("알 수 없는 id이면 해당 id를 포함한 유용한 오류를 던진다", () => {
    expect(() => byId([M1, M2, M3], "MX")).toThrowError("metrics.json 에 MX 정의가 없습니다.");
  });
});
