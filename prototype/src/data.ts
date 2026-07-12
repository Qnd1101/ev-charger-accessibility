/**
 * 정적 희소 집계 로딩과 조회.
 *
 * 지표 공식의 원본은 Python(`src/metrics.py`)이다. 여기서는 미리 집계된 셀을
 * **더하기만** 한다. 새 공식을 여기에 만들면 Python 과 화면이 갈라진다(DESIGN.md 데이터 경계).
 */

export const SPEED = { ALL: 0, FAST: 1, SLOW: 2 } as const;
export const H24 = { ALL: 0, ONLY: 1 } as const;

export type SpeedFilter = (typeof SPEED)[keyof typeof SPEED];

/** [zscode, opIdx, speed, h24, 충전기, 충전소, 응답, 사용가능] */
type RegionRow = [number, number, number, number, number, number, number, number];
/** [lat*1000, lng*1000, zcode, opIdx, 급속, 24시간, 충전기] */
type GridRow = [number, number, number, number, number, number, number];

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
}

export interface Dataset {
  meta: Meta;
  operators: string[];
  regions: Region[];
  sidos: Sido[];
  regionCube: RegionRow[];
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

  const [meta, operators, regionsFile, regionCube, gridCube] = await Promise.all([
    get<Meta>("meta.json"),
    get<string[]>("operators.json"),
    get<{ regions: Region[]; sidos: Sido[] }>("regions.json"),
    get<RegionRow[]>("region_cube.json"),
    get<GridRow[]>("grid_cube.json"),
  ]);

  return { meta, operators, regions: regionsFile.regions, sidos: regionsFile.sidos, regionCube, gridCube };
}

/** 지역별 집계. 필터가 0건으로 만든 지역도 0 으로 남는다 -- '미진출'을 보여야 하기 때문. */
export interface RegionTotals {
  chargers: number;
  stations: number;
  live: number;
  available: number;
}

export function aggregateRegions(data: Dataset, f: Filters): Map<number, RegionTotals> {
  const zcodes = new Set(f.zcodes);
  const ops = new Set(f.operators);
  const h24 = f.only24h ? H24.ONLY : H24.ALL;
  const zOf = new Map(data.regions.map((r) => [r.zscode, r.zcode]));

  const out = new Map<number, RegionTotals>();
  for (const [zscode, op, speed, h, chargers, stations, live, available] of data.regionCube) {
    if (speed !== f.speed || h !== h24) continue;
    if (ops.size && !ops.has(op)) continue;
    if (zcodes.size && !zcodes.has(zOf.get(zscode) ?? -1)) continue;

    const cur = out.get(zscode) ?? { chargers: 0, stations: 0, live: 0, available: 0 };
    cur.chargers += chargers;
    cur.stations += stations;
    cur.live += live;
    cur.available += available;
    out.set(zscode, cur);
  }
  return out;
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

export interface Kpis {
  stations: number;
  chargers: number;
  fastRatio: number | null;
  idleRatio: number | null;
}

export function computeKpis(data: Dataset, f: Filters, totals: Map<number, RegionTotals>): Kpis {
  let stations = 0;
  let chargers = 0;
  let live = 0;
  let available = 0;
  for (const t of totals.values()) {
    stations += t.stations;
    chargers += t.chargers;
    live += t.live;
    available += t.available;
  }

  // M3(급속 비율)는 '전체' 슬라이스가 있어야 분모가 생긴다. 속도 필터가 걸려 있으면
  // 모집단 자체가 급속(또는 완속)이므로 비율은 정의상 100%/0% 다 -- Streamlit 과 같은 규칙.
  let fastRatio: number | null = null;
  if (f.speed === SPEED.FAST) fastRatio = chargers ? 1 : null;
  else if (f.speed === SPEED.SLOW) fastRatio = chargers ? 0 : null;
  else {
    const fastOnly = aggregateRegions(data, { ...f, speed: SPEED.FAST });
    let fast = 0;
    for (const t of fastOnly.values()) fast += t.chargers;
    fastRatio = chargers ? fast / chargers : null;
  }

  return { stations, chargers, fastRatio, idleRatio: live ? available / live : null };
}
