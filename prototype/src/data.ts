/**
 * 정적 희소 집계 로딩과 조회.
 *
 * 지표 공식의 원본은 Python(`src/metrics.py`)이다. 여기서는 미리 집계된 셀을
 * **더하기만** 한다. 새 공식을 여기에 만들면 Python 과 화면이 갈라진다(DESIGN.md 데이터 경계).
 */

import type { MetricSpec, Terms } from "./metrics";

export const SPEED = { ALL: 0, FAST: 1, SLOW: 2 } as const;
export const H24 = { ALL: 0, ONLY: 1 } as const;

export type SpeedFilter = (typeof SPEED)[keyof typeof SPEED];

/** [zscode, opIdx, speed, h24, 충전기, 충전소, 급속, 응답, 사용가능] */
type RegionRow = [number, number, number, number, number, number, number, number, number];
/** [lat*1000, lng*1000, zcode, opIdx, 급속, 24시간, 충전기] */
type GridRow = [number, number, number, number, number, number, number];
/** [zscode, opIdx, speed, h24, ...StatusCube.labels 순서대로 충전기 수] */
type StatusRow = number[];

export interface StatusCube {
  /** 상태 라벨. 순서가 각 StatusRow 뒤쪽 카운트 열의 순서와 같다(Python `status_labels`). */
  labels: string[];
  rows: StatusRow[];
}

export interface Meta {
  snapshot_date: string;
  ev_date: string;
  population_date: string | null;
  population_label: string | null;
  total_chargers: number;
  invalid_coord_chargers: number;
  grid_deg: number;
  top_operators: string[];
  station_overcount_max: number;
}

export interface Region {
  zscode: number;
  zcode: number;
  sido: string;
  sigungu: string;
  population: number | null;
}

export interface Sido {
  zcode: number;
  name: string;
  ev_count: number;
  population: number | null;
}

export interface Dataset {
  meta: Meta;
  /** 지표 공식의 정의. Python 이 내보낸다 -- 화면은 읽기만 한다. */
  metrics: MetricSpec[];
  operators: string[];
  regions: Region[];
  sidos: Sido[];
  regionCube: RegionRow[];
  statusCube: StatusCube;
  gridCube: GridRow[];
}

export interface Filters {
  /** 빈 배열 = 전국 */
  zcodes: number[];
  speed: SpeedFilter;
  /** 빈 배열 = 전체 운영기관 */
  operators: number[];
  only24h: boolean;
}

export const EMPTY_FILTERS: Filters = { zcodes: [], speed: SPEED.ALL, operators: [], only24h: false };

export async function loadDataset(): Promise<Dataset> {
  const get = async <T,>(name: string): Promise<T> => {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
    if (!res.ok) {
      throw new Error(
        `집계 파일 ${name} 을 읽지 못했습니다 (HTTP ${res.status}). ` +
          `\`python scripts/build_web_data.py\` 로 다시 생성하세요.`,
      );
    }
    return res.json() as Promise<T>;
  };

  const [meta, metrics, operators, regionsFile, regionCube, statusCube, gridCube] = await Promise.all([
    get<Meta>("meta.json"),
    get<MetricSpec[]>("metrics.json"),
    get<string[]>("operators.json"),
    get<{ regions: Region[]; sidos: Sido[] }>("regions.json"),
    get<RegionRow[]>("region_cube.json"),
    get<StatusCube>("status_cube.json"),
    get<GridRow[]>("grid_cube.json"),
  ]);

  return {
    meta,
    metrics,
    operators,
    regions: regionsFile.regions,
    sidos: regionsFile.sidos,
    regionCube,
    statusCube,
    gridCube,
  };
}

/**
 * 지역별 집계. 필터가 0건으로 만든 지역도 0 으로 남는다 -- '미진출'을 보여야 하기 때문.
 *
 * 반환하는 항 이름은 `metric_specs.py` 의 항 이름과 **같아야 한다.** 지표 평가기가
 * 이 객체를 그대로 받아 나누기 때문이다.
 */
const ZERO: Terms = {
  charger_count: 0,
  station_count: 0,
  fast_count: 0,
  live_count: 0,
  available_count: 0,
};

export function aggregateRegions(data: Dataset, f: Filters): Map<number, Terms> {
  const zcodes = new Set(f.zcodes);
  const ops = new Set(f.operators);
  const h24 = f.only24h ? H24.ONLY : H24.ALL;
  const zOf = new Map(data.regions.map((r) => [r.zscode, r.zcode]));

  const out = new Map<number, Terms>();
  for (const [zscode, op, speed, h, chargers, stations, fast, live, available] of data.regionCube) {
    if (speed !== f.speed || h !== h24) continue;
    if (ops.size && !ops.has(op)) continue;
    if (zcodes.size && !zcodes.has(zOf.get(zscode) ?? -1)) continue;

    const cur = out.get(zscode) ?? { ...ZERO };
    cur.charger_count! += chargers;
    cur.station_count! += stations;
    cur.fast_count! += fast;
    cur.live_count! += live;
    cur.available_count! += available;
    out.set(zscode, cur);
  }
  return out;
}

/** 필터 범위 합계. 카운트는 모든 필터를 따르고, 인구·EV 분모는 선택한 지리 범위만 따른다. */
export function totalTerms(data: Dataset, f: Filters, totals: Map<number, Terms>): Terms {
  const sum: Terms = { ...ZERO };
  for (const t of totals.values()) {
    sum.charger_count! += t.charger_count!;
    sum.station_count! += t.station_count!;
    sum.fast_count! += t.fast_count!;
    sum.live_count! += t.live_count!;
    sum.available_count! += t.available_count!;
  }

  const zcodes = new Set(f.zcodes);
  const inScope = <T extends { zcode: number }>(r: T) => !zcodes.size || zcodes.has(r.zcode);

  let population = 0;
  let popKnown = false;
  for (const r of data.regions) {
    if (inScope(r) && r.population != null) {
      population += r.population;
      popKnown = true;
    }
  }
  // 시군구 인구가 없으면 시도 인구로 떨어진다(build_web_data 가 해상도에 맞는 쪽에 싣는다).
  if (!popKnown) {
    for (const s of data.sidos) {
      if (inScope(s) && s.population != null) {
        population += s.population;
        popKnown = true;
      }
    }
  }
  if (popKnown) sum.population = population;

  let ev = 0;
  for (const s of data.sidos) if (inScope(s)) ev += s.ev_count;
  if (ev > 0) sum.ev_count = ev;

  return sum;
}

/**
 * 필터 범위의 충전기 상태 분포. 반환값은 `data.statusCube.labels`와 같은 순서의 개수
 * 배열이다 -- 합계는 `aggregateRegions`/`totalTerms`의 `charger_count`와 항상 일치해야
 * 한다(같은 (zscode, opIdx, speed, h24) 키에서 나온 값이라서다).
 */
export function aggregateStatusDistribution(data: Dataset, f: Filters): number[] {
  const zcodes = new Set(f.zcodes);
  const ops = new Set(f.operators);
  const h24 = f.only24h ? H24.ONLY : H24.ALL;
  const zOf = new Map(data.regions.map((r) => [r.zscode, r.zcode]));
  const labelCount = data.statusCube.labels.length;

  const sums = new Array<number>(labelCount).fill(0);
  for (const row of data.statusCube.rows) {
    const [zscode, op, speed, h] = row;
    if (speed !== f.speed || h !== h24) continue;
    if (ops.size && !ops.has(op)) continue;
    if (zcodes.size && !zcodes.has(zOf.get(zscode) ?? -1)) continue;

    for (let i = 0; i < labelCount; i++) sums[i] += row[4 + i];
  }
  return sums;
}

export interface Cell {
  lat: number;
  lng: number;
  count: number;
}

/**
 * 격자 셀. 충전기 수는 합산 가능하므로 원자 슬라이스를 더한다.
 * 좌표 무효 충전기는 애초에 격자에 없다 -- 지도와 KPI 합계가 다른 이유다.
 */
export function aggregateGrid(data: Dataset, f: Filters): Cell[] {
  const zcodes = new Set(f.zcodes);
  const ops = new Set(f.operators);
  const acc = new Map<number, Cell>();

  for (const [latE3, lngE3, zcode, op, fast, h24, count] of data.gridCube) {
    if (f.speed === SPEED.FAST && !fast) continue;
    if (f.speed === SPEED.SLOW && fast) continue;
    if (f.only24h && !h24) continue;
    if (ops.size && !ops.has(op)) continue;
    if (zcodes.size && !zcodes.has(zcode)) continue;

    const key = latE3 * 1e6 + lngE3;
    const cur = acc.get(key);
    if (cur) cur.count += count;
    else acc.set(key, { lat: latE3 / 1000, lng: lngE3 / 1000, count });
  }
  return [...acc.values()];
}

export type { Terms, MetricSpec };
