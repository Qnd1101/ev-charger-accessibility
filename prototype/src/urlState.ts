import { EMPTY_FILTERS, SPEED, type Filters, type SpeedFilter } from "./data";

export type UrlMapView = "region" | "supply" | "grid" | "heat" | "bubble";
export type UrlRankMetricId = "M1" | "M2";

export interface UrlStateDataset {
  operators: string[];
  sidos: Array<{ zcode: number }>;
}

export interface ParsedFilterQuery {
  filters: Filters;
  view: UrlMapView;
  rankMetricId: UrlRankMetricId;
}

export const DEFAULT_VIEW: UrlMapView = "region";
export const DEFAULT_RANK_METRIC_ID: UrlRankMetricId = "M2";

const SPEED_TOKENS: Record<Exclude<SpeedFilter, typeof SPEED.ALL>, string> = {
  [SPEED.FAST]: "fast",
  [SPEED.SLOW]: "slow",
};

const TOKEN_SPEEDS = new Map<string, SpeedFilter>([
  ["fast", SPEED.FAST],
  ["slow", SPEED.SLOW],
]);

const MAP_VIEWS = new Set<UrlMapView>(["region", "supply", "grid", "heat", "bubble"]);
const RANK_METRICS = new Set<UrlRankMetricId>(["M1", "M2"]);

function singleValue(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

function parseZcodes(params: URLSearchParams, dataset: UrlStateDataset): number[] {
  const value = singleValue(params, "z");
  if (!value) return [];

  const tokens = value.split(",");
  if (tokens.some((token) => !/^\d+$/.test(token))) return [];

  const currentZcodes = new Set(dataset.sidos.map((sido) => sido.zcode));
  return [...new Set(tokens.map(Number).filter((zcode) => currentZcodes.has(zcode)))];
}

function parseOperators(params: URLSearchParams, dataset: UrlStateDataset): number[] {
  const value = singleValue(params, "op");
  if (!value) return [];

  try {
    const names: unknown = JSON.parse(value);
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) return [];

    const indexesByName = new Map(dataset.operators.map((name, index) => [name, index]));
    return [
      ...new Set(
        names.flatMap((name) => {
          const index = indexesByName.get(name);
          return index === undefined ? [] : [index];
        }),
      ),
    ];
  } catch {
    return [];
  }
}

function parseSpeed(params: URLSearchParams): SpeedFilter {
  const value = singleValue(params, "speed");
  return value ? (TOKEN_SPEEDS.get(value) ?? SPEED.ALL) : SPEED.ALL;
}

function parseOnly24h(params: URLSearchParams): boolean {
  return singleValue(params, "h24") === "1";
}

function parseView(params: URLSearchParams): UrlMapView {
  const value = singleValue(params, "view");
  return value && MAP_VIEWS.has(value as UrlMapView) ? (value as UrlMapView) : DEFAULT_VIEW;
}

function parseRankMetric(params: URLSearchParams): UrlRankMetricId {
  const value = singleValue(params, "metric");
  return value && RANK_METRICS.has(value as UrlRankMetricId)
    ? (value as UrlRankMetricId)
    : DEFAULT_RANK_METRIC_ID;
}

/**
 * 현재 데이터 스냅샷에 맞춰 URL 쿼리를 분석 상태로 바꾼다.
 * 각 차원은 독립적으로 검증하며 잘못된 값은 예외 없이 그 차원의 기본값으로 강등한다.
 */
export function parseFilterQuery(search: string, dataset: UrlStateDataset): ParsedFilterQuery {
  const params = new URLSearchParams(search);
  return {
    filters: {
      ...EMPTY_FILTERS,
      zcodes: parseZcodes(params, dataset),
      operators: parseOperators(params, dataset),
      speed: parseSpeed(params),
      only24h: parseOnly24h(params),
    },
    view: parseView(params),
    rankMetricId: parseRankMetric(params),
  };
}

/**
 * 기본값이 아닌 분석 상태만 쿼리로 만든다. 운영기관은 스냅샷마다 바뀌는 인덱스 대신
 * 이름을 기록해 데이터가 재생성된 뒤에도 같은 기관을 가리키게 한다.
 */
export function serializeFilterQuery(
  filters: Filters,
  view: UrlMapView,
  rankMetricId: UrlRankMetricId,
  dataset: UrlStateDataset,
): string {
  const params = new URLSearchParams();
  const currentZcodes = new Set(dataset.sidos.map((sido) => sido.zcode));
  const zcodes = [...new Set(filters.zcodes.filter((zcode) => currentZcodes.has(zcode)))];
  if (zcodes.length) params.set("z", zcodes.join(","));

  const operatorNames = [
    ...new Set(filters.operators.flatMap((index) => dataset.operators[index] ?? [])),
  ];
  if (operatorNames.length) params.set("op", JSON.stringify(operatorNames));

  if (filters.speed !== SPEED.ALL) params.set("speed", SPEED_TOKENS[filters.speed]);
  if (filters.only24h) params.set("h24", "1");
  if (view !== DEFAULT_VIEW) params.set("view", view);
  if (rankMetricId !== DEFAULT_RANK_METRIC_ID) params.set("metric", rankMetricId);

  return params.toString();
}
