import {
  SPEED,
  aggregateRegions,
  aggregateStatusDistribution,
  totalTerms,
  type Dataset,
  type Filters,
  type SpeedFilter,
} from "./data";
import { byId, evaluate, type Terms } from "./metrics";
import type { RankRow } from "./RankingChart";

export const RANK_SIZE = 12;

export const SPEED_LABELS: [SpeedFilter, string][] = [
  [SPEED.ALL, "전체"],
  [SPEED.FAST, "급속만"],
  [SPEED.SLOW, "완속만"],
];

export type RankMetricId = "M1" | "M2";

export interface MapRegionValue {
  zscode: number;
  value: number | null;
  vulnerability: number | null;
}

export interface MapMetric {
  regionValues: MapRegionValue[];
  fixedVulnerabilityMax: number | undefined;
}

export interface FilterChip {
  key: string;
  label: string;
  relaxed: Filters;
}

export interface ActiveFilterDescription {
  chips: FilterChip[];
  emptyReasons: string[];
}

export interface RecoverabilityDimension {
  key: "region" | "operator" | "speed" | "hours";
  label: string;
  relaxed: Filters;
  restored: boolean;
}

type RecoverabilityProbe = Omit<RecoverabilityDimension, "restored">;

export interface StatusRow {
  label: string;
  count: number;
}

/**
 * 랭킹 축의 시도 축약. 앞 두 글자만 자르면 전라남도/전라북도가 모두 '전라'가 되므로
 * 서로 구분되는 관용 축약(전남·경북·충북 등)을 쓴다.
 */
function shortSido(name: string): string {
  return /^(전라|경상|충청)/.test(name) ? name[0] + name[2] : name.slice(0, 2);
}

/**
 * 접근성 취약 랭킹을 지표 정의에 따라 만든다.
 *
 * M1은 한전 EV 등록 통계가 시도 단위라 항상 시도로 세운다. M2는 시군구 인구가 있으면
 * 시군구를 쓰고, 전 지역의 시군구 인구가 없으면 시도 인구로 강등해 빈 표를 내놓지 않는다.
 * 운영기관 선택 뒤 0기인 지역은 국가 인프라 '부족'이 아니라 그 기관의 '미진출'이므로
 * 결과에서 제외하지 않고 별도 상태로 남긴다(CONTEXT.md 용어 구분).
 */
export function deriveRanking(
  data: Dataset,
  filters: Filters,
  totals: Map<number, Terms>,
  rankMetricId: RankMetricId,
  rankSize: number,
): RankRow[] {
  const inScope = (zcode: number) => !filters.zcodes.length || filters.zcodes.includes(zcode);
  const absent = (terms: Terms) => terms.charger_count === 0 && filters.operators.length > 0;

  const byZcode = () => {
    const acc = new Map<number, Terms>();
    const zcodesByZscode = new Map(data.regions.map((region) => [region.zscode, region.zcode]));
    for (const [zscode, terms] of totals) {
      const zcode = zcodesByZscode.get(zscode);
      if (zcode === undefined) continue;
      const current = acc.get(zcode) ?? { charger_count: 0 };
      current.charger_count! += terms.charger_count ?? 0;
      acc.set(zcode, current);
    }
    return acc;
  };

  if (rankMetricId === "M1") {
    const spec = byId(data.metrics, "M1");
    const chargersByZcode = byZcode();
    return data.sidos
      .filter((sido) => inScope(sido.zcode))
      .map((sido) => {
        const terms: Terms = {
          ...(chargersByZcode.get(sido.zcode) ?? { charger_count: 0 }),
          ev_count: sido.ev_count,
        };
        return { name: sido.name, value: evaluate(spec, terms), absent: absent(terms) };
      })
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
      .slice(0, rankSize);
  }

  const spec = byId(data.metrics, "M2");
  const sigunguRows = data.regions
    .filter((region) => inScope(region.zcode) && region.population)
    .map((region) => {
      const terms: Terms = {
        ...(totals.get(region.zscode) ?? { charger_count: 0 }),
        population: region.population!,
      };
      return {
        name: `${shortSido(region.sido)} ${region.sigungu}`,
        value: evaluate(spec, terms),
        absent: absent(terms),
      };
    });
  if (sigunguRows.length) {
    return sigunguRows.sort((a, b) => (a.value ?? 0) - (b.value ?? 0)).slice(0, rankSize);
  }

  // 시군구 인구가 없다 -> 시도로 강등한다. 빈 표를 내놓지 않는다.
  const chargersByZcode = byZcode();
  return data.sidos
    .filter((sido) => inScope(sido.zcode) && sido.population)
    .map((sido) => {
      const terms: Terms = {
        ...(chargersByZcode.get(sido.zcode) ?? { charger_count: 0 }),
        population: sido.population!,
      };
      return { name: sido.name, value: evaluate(spec, terms), absent: absent(terms) };
    })
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    .slice(0, rankSize);
}

/**
 * Python이 내보낸 M2 표시값을 지도용 취약 방향으로 정규화한다. 극성에 따라 방향만
 * 맞추고 범위를 제한하며, ADR 0001에 따라 필터와 무관한 무필터 전국 도메인을 고정한다.
 */
export function deriveMapMetric(
  data: Dataset,
  totals: Map<number, Terms>,
  nationalTotals: Map<number, Terms>,
): MapMetric {
  const spec = byId(data.metrics, "M2");
  const valuesFor = (regionTotals: Map<number, Terms>) => data.regions.map((region) => {
    const terms: Terms = {
      ...(regionTotals.get(region.zscode) ?? {}),
      ...(region.population == null ? {} : { population: region.population }),
    };
    return { zscode: region.zscode, value: evaluate(spec, terms) };
  });
  const nationalValues = valuesFor(nationalTotals);
  const valid = nationalValues.flatMap(({ value }) => value == null ? [] : [value]);
  if (!valid.length || spec.polarity === "neutral") {
    return {
      regionValues: valuesFor(totals).map((region) => ({ ...region, vulnerability: null })),
      fixedVulnerabilityMax: undefined,
    };
  }

  const lower = Math.min(...valid);
  const upper = Math.max(...valid);
  const fixedVulnerabilityMax = upper - lower;
  const vulnerabilityOf = (value: number | null) => {
    if (value == null) return null;
    const directed = spec.polarity === "low_is_vulnerable" ? upper - value : value - lower;
    return Math.min(fixedVulnerabilityMax, Math.max(0, directed));
  };
  return {
    regionValues: valuesFor(totals).map((region) => ({
      ...region,
      vulnerability: vulnerabilityOf(region.value),
    })),
    fixedVulnerabilityMax,
  };
}

/** 활성 필터의 화면 문구와, 각 칩 하나만 해제했을 때의 필터 값을 함께 만든다. */
export function describeActiveFilters(data: Dataset, filters: Filters): ActiveFilterDescription {
  const chips: FilterChip[] = [
    ...filters.zcodes.map((zcode) => ({
      key: `z${zcode}`,
      label: data.sidos.find((sido) => sido.zcode === zcode)?.name ?? String(zcode),
      relaxed: { ...filters, zcodes: filters.zcodes.filter((value) => value !== zcode) },
    })),
    ...(filters.speed !== SPEED.ALL
      ? [{
          key: "speed",
          label: SPEED_LABELS.find(([value]) => value === filters.speed)![1],
          relaxed: { ...filters, speed: SPEED.ALL },
        }]
      : []),
    ...filters.operators.map((operator) => ({
      key: `o${operator}`,
      label: data.operators[operator],
      relaxed: { ...filters, operators: filters.operators.filter((value) => value !== operator) },
    })),
    ...(filters.only24h
      ? [{
          key: "h24",
          label: "24시간 이용가능",
          relaxed: { ...filters, only24h: false },
        }]
      : []),
  ];

  const emptyReasons = [
    filters.zcodes.length > 0
      ? `선택 지역: ${filters.zcodes.map((zcode) => data.sidos.find((sido) => sido.zcode === zcode)?.name ?? zcode).join(", ")}`
      : null,
    filters.operators.length > 0
      ? `선택 운영기관: ${filters.operators.map((operator) => data.operators[operator]).join(", ")}`
      : null,
    filters.speed !== SPEED.ALL
      ? `충전 속도: ${SPEED_LABELS.find(([value]) => value === filters.speed)?.[1]}`
      : null,
    filters.only24h ? "이용 시간: 24시간 이용가능만" : null,
  ].filter((reason): reason is string => reason !== null);

  return { chips, emptyReasons };
}

/**
 * 결과가 0기일 때 각 활성 차원 하나만 완화해 본다. 다른 조건은 모두 고정해야
 * 단일 원인과 여러 조건의 교집합 원인을 구분할 수 있다.
 */
export function deriveRecoverability(data: Dataset, filters: Filters): RecoverabilityDimension[] {
  const dimensions: Array<RecoverabilityProbe | null> = [
    filters.zcodes.length > 0
      ? { key: "region" as const, label: "지역", relaxed: { ...filters, zcodes: [] } }
      : null,
    filters.operators.length > 0
      ? { key: "operator" as const, label: "운영기관", relaxed: { ...filters, operators: [] } }
      : null,
    filters.speed !== SPEED.ALL
      ? { key: "speed" as const, label: "충전 속도", relaxed: { ...filters, speed: SPEED.ALL } }
      : null,
    filters.only24h
      ? { key: "hours" as const, label: "이용 시간", relaxed: { ...filters, only24h: false } }
      : null,
  ];

  return dimensions.filter((dimension): dimension is RecoverabilityProbe => dimension !== null).map((dimension) => {
    const relaxedTotals = aggregateRegions(data, dimension.relaxed);
    const restored = (totalTerms(data, dimension.relaxed, relaxedTotals).charger_count ?? 0) > 0;
    return { ...dimension, restored };
  });
}

/** 개요 패널의 상태별 충전기 수를 0이 아닌 행만 큰 값부터 정렬한다. */
export function deriveStatusRows(data: Dataset, filters: Filters): StatusRow[] {
  const counts = aggregateStatusDistribution(data, filters);
  return data.statusCube.labels
    .map((label, index) => ({ label, count: counts[index] ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** 운영기관 목록의 보조 개수는 무필터(speed=전체, h24=전체) 큐브 행에서 합산한다. */
export function deriveOperatorCounts(data: Dataset): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [, operator, speed, h24, chargers] of data.regionCube) {
    if (speed !== SPEED.ALL || h24 !== 0) continue;
    counts.set(operator, (counts.get(operator) ?? 0) + chargers);
  }
  return counts;
}
