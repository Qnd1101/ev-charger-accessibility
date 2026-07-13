/** 시군구 경계 로더. MapLibre가 직접 읽지 못하는 TopoJSON을 GeoJSON으로 변환한다. */

export interface BoundaryValue {
  zscode: number;
  /** 툴팁 등에 표시할 Python 산출 지표 값. */
  value: number | null;
  /** Python 지표 극성으로 변환된 취약도. 3D 높이와 색이 이 값 하나를 공유한다. */
  vulnerability: number | null;
}

type Position = [number, number];
type Arc = Position[];

interface TopologyGeometry {
  type: "Polygon" | "MultiPolygon";
  arcs: number[][] | number[][][];
  properties?: Record<string, unknown>;
  id?: string | number;
}

interface Topology {
  type: "Topology";
  transform?: { scale: Position; translate: Position };
  arcs: Arc[];
  objects: Record<string, { type: "GeometryCollection"; geometries: TopologyGeometry[] }>;
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  return !!value && typeof value === "object" && (value as { type?: string }).type === "FeatureCollection";
}

function decodeArcs(topology: Topology): Arc[] {
  if (!topology.transform) return topology.arcs;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [
        x * topology.transform!.scale[0] + topology.transform!.translate[0],
        y * topology.transform!.scale[1] + topology.transform!.translate[1],
      ];
    });
  });
}

export interface ThreeDimensionalContext {
  boundariesReady: boolean;
  hasFixedDomain: boolean;
  motionReduced: boolean;
  mobile: boolean;
  zoom: number;
  minZoom: number;
}

export function getThreeDimensionalAvailability(context: ThreeDimensionalContext): {
  allowed: boolean;
  reason: string;
} {
  if (context.motionReduced) {
    return { allowed: false, reason: "동작 줄이기 설정에서는 3D를 제공하지 않습니다." };
  }
  if (context.mobile) {
    return { allowed: false, reason: "모바일 화면에서는 3D를 제공하지 않습니다." };
  }
  if (context.zoom < context.minZoom) {
    return { allowed: false, reason: "지역이 겹치지 않도록 지도를 더 확대해야 3D를 사용할 수 있습니다." };
  }
  if (!context.hasFixedDomain) {
    return { allowed: false, reason: "전국 기준 고정 취약도 범위가 없어 3D를 사용할 수 없습니다." };
  }
  if (!context.boundariesReady) {
    return { allowed: false, reason: "시군구 경계와 지역 값이 준비되어야 3D를 사용할 수 있습니다." };
  }
  return { allowed: true, reason: "" };
}

function stitch(indexes: number[], arcs: Arc[]): Arc {
  const ring: Arc = [];
  for (const index of indexes) {
    const source = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
    ring.push(...(ring.length ? source.slice(1) : source));
  }
  return ring;
}

export function topologyToFeatureCollection(topology: Topology): GeoJSON.FeatureCollection {
  const object = Object.values(topology.objects)[0];
  if (!object || object.type !== "GeometryCollection") {
    throw new Error("시군구 TopoJSON에 GeometryCollection이 없습니다.");
  }
  const arcs = decodeArcs(topology);
  return {
    type: "FeatureCollection",
    features: object.geometries.map((geometry) => ({
      type: "Feature",
      id: geometry.id,
      properties: geometry.properties ?? {},
      geometry: geometry.type === "Polygon"
        ? { type: "Polygon", coordinates: (geometry.arcs as number[][]).map((ring) => stitch(ring, arcs)) }
        : { type: "MultiPolygon", coordinates: (geometry.arcs as number[][][]).map((polygon) => polygon.map((ring) => stitch(ring, arcs))) },
    })),
  };
}

export async function loadSigunguBoundaries(url: string): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`시군구 경계 파일을 읽지 못했습니다 (HTTP ${response.status}).`);
  const value: unknown = await response.json();
  if (isFeatureCollection(value)) return value;
  if (value && typeof value === "object" && (value as { type?: string }).type === "Topology") {
    return topologyToFeatureCollection(value as Topology);
  }
  throw new Error("시군구 경계 파일이 TopoJSON 또는 GeoJSON이 아닙니다.");
}

export function boundaryCode(feature: GeoJSON.Feature): number | null {
  const properties = feature.properties ?? {};
  const raw = properties.SIG_CD ?? properties.sig_cd ?? properties.zscode ?? feature.id;
  const code = Number(raw);
  return Number.isInteger(code) ? code : null;
}

export interface BoundaryJoinContract {
  invalidBoundaryFeatureIndexes: number[];
  duplicateBoundaryCodes: number[];
  duplicateValueCodes: number[];
  missingValueCodes: number[];
  extraValueCodes: number[];
}

function duplicates(codes: number[]): number[] {
  const seen = new Set<number>();
  const repeated = new Set<number>();
  for (const code of codes) {
    if (seen.has(code)) repeated.add(code);
    seen.add(code);
  }
  return [...repeated].sort((a, b) => a - b);
}

// 2023년 군위군 편입 전 코드는 데이터 호환을 위해 현행 대구 코드로만 정규화한다.
// 물리 경계 자체를 복제하면 동일 도형이 겹쳐 유효한 값을 가릴 수 있으므로 금지한다.
const VALUE_CODE_ALIASES = new Map<number, number>([[47720, 27720]]);

function canonicalValueCode(code: number): number {
  return VALUE_CODE_ALIASES.get(code) ?? code;
}

function valueHasPayload({ value, vulnerability }: BoundaryValue): boolean {
  return value !== null && Number.isFinite(value)
    && vulnerability !== null && Number.isFinite(vulnerability);
}

function groupValues(values: BoundaryValue[]): Map<number, BoundaryValue[]> {
  const groups = new Map<number, BoundaryValue[]>();
  for (const value of values) {
    const code = canonicalValueCode(value.zscode);
    groups.set(code, [...(groups.get(code) ?? []), value]);
  }
  return groups;
}

function duplicateCanonicalValueCodes(values: BoundaryValue[]): number[] {
  const rawDuplicates = duplicates(values.map(({ zscode }) => zscode)).map(canonicalValueCode);
  const aliasConflicts = [...groupValues(values)].flatMap(([code, group]) => {
    const rawCodes = new Set(group.map(({ zscode }) => zscode));
    return rawCodes.size > 1 && group.filter(valueHasPayload).length > 1 ? [code] : [];
  });
  return [...new Set([...rawDuplicates, ...aliasConflicts])].sort((a, b) => a - b);
}

export function inspectBoundaryJoin(
  boundaries: GeoJSON.FeatureCollection,
  values: BoundaryValue[],
): BoundaryJoinContract {
  const invalidBoundaryFeatureIndexes: number[] = [];
  const boundaryCodes = boundaries.features.flatMap((feature, index) => {
    const code = boundaryCode(feature);
    if (code === null) invalidBoundaryFeatureIndexes.push(index);
    return code === null ? [] : [code];
  });
  const valueCodes = values.map(({ zscode }) => canonicalValueCode(zscode));
  const boundarySet = new Set(boundaryCodes);
  const valueSet = new Set(valueCodes);
  return {
    invalidBoundaryFeatureIndexes,
    duplicateBoundaryCodes: duplicates(boundaryCodes),
    duplicateValueCodes: duplicateCanonicalValueCodes(values),
    missingValueCodes: [...boundarySet].filter((code) => !valueSet.has(code)).sort((a, b) => a - b),
    extraValueCodes: [...valueSet].filter((code) => !boundarySet.has(code)).sort((a, b) => a - b),
  };
}

export function boundaryJoinIsExact(contract: BoundaryJoinContract): boolean {
  return Object.values(contract).every((codes) => codes.length === 0);
}

export function hasUsableBoundaryValues(values: BoundaryValue[]): boolean {
  return values.some(({ value, vulnerability }) =>
    value !== null && Number.isFinite(value) && vulnerability !== null && Number.isFinite(vulnerability));
}

export function joinBoundaryValues(
  boundaries: GeoJSON.FeatureCollection,
  values: BoundaryValue[],
): GeoJSON.FeatureCollection {
  const grouped = groupValues(values);
  return {
    type: "FeatureCollection",
    features: boundaries.features.map((feature) => {
      const zscode = boundaryCode(feature);
      const candidates = zscode === null ? [] : (grouped.get(zscode) ?? []);
      const value = candidates.find((candidate) => candidate.zscode === zscode && valueHasPayload(candidate))
        ?? candidates.find(valueHasPayload)
        ?? candidates.find((candidate) => candidate.zscode === zscode)
        ?? candidates[0];
      const vulnerability = value?.vulnerability;
      return {
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          zscode,
          value: value?.value ?? null,
          ...(vulnerability === null || vulnerability === undefined ? {} : { vulnerability }),
        },
      };
    }),
  };
}
