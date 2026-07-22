import { describe, expect, it } from "vitest";

import {
  deriveFallbackNotice,
  deriveLayerVisibility,
  type BoundaryState,
  type LayerVisibility,
  type MapView,
} from "./mapView";

const VIEWS: MapView[] = ["region", "supply", "grid", "heat", "bubble"];
const BOUNDARY_STATES: BoundaryState[] = ["loading", "ready", "missing", "unconnected"];

const VISIBILITY: Record<MapView, Record<"ready2d" | "ready3d" | "fallback", LayerVisibility>> = {
  region: {
    ready2d: { grid: false, heat: false, bubble: false, choropleth: true, vulnerability3d: false },
    ready3d: { grid: false, heat: false, bubble: false, choropleth: false, vulnerability3d: true },
    fallback: { grid: true, heat: false, bubble: false, choropleth: false, vulnerability3d: false },
  },
  // supply(지역별 충전기 수)는 경계 소스·강등 규칙을 region과 공유한다 — 3D 게이팅만
  // 호출부(view === "region")에서 별도로 막는다.
  supply: {
    ready2d: { grid: false, heat: false, bubble: false, choropleth: true, vulnerability3d: false },
    ready3d: { grid: false, heat: false, bubble: false, choropleth: false, vulnerability3d: true },
    fallback: { grid: true, heat: false, bubble: false, choropleth: false, vulnerability3d: false },
  },
  grid: {
    ready2d: { grid: true, heat: false, bubble: false, choropleth: true, vulnerability3d: false },
    ready3d: { grid: true, heat: false, bubble: false, choropleth: false, vulnerability3d: true },
    fallback: { grid: true, heat: false, bubble: false, choropleth: false, vulnerability3d: false },
  },
  heat: {
    ready2d: { grid: false, heat: true, bubble: false, choropleth: true, vulnerability3d: false },
    ready3d: { grid: false, heat: true, bubble: false, choropleth: false, vulnerability3d: true },
    fallback: { grid: true, heat: false, bubble: false, choropleth: false, vulnerability3d: false },
  },
  bubble: {
    ready2d: { grid: false, heat: false, bubble: true, choropleth: false, vulnerability3d: false },
    // active3d는 호출부에서 view === "region"일 때만 true가 되므로 실제로는 도달하지
    // 않는 조합이지만, 공식 자체는 view와 무관하게 vulnerability3d = !fallback && active3d다.
    ready3d: { grid: false, heat: false, bubble: true, choropleth: false, vulnerability3d: true },
    fallback: { grid: false, heat: false, bubble: true, choropleth: false, vulnerability3d: false },
  },
};

const layerCases = VIEWS.flatMap((view) => [
  {
    name: `${view} / 경계 준비 / 2D`,
    view,
    input: { basemapMissing: false, boundaryReady: true, active3d: false },
    expected: VISIBILITY[view].ready2d,
  },
  {
    name: `${view} / 경계 준비 / 3D`,
    view,
    input: { basemapMissing: false, boundaryReady: true, active3d: true },
    expected: VISIBILITY[view].ready3d,
  },
  ...(["loading", "missing", "unconnected"] as const).map((boundaryState) => ({
    name: `${view} / 경계 ${boundaryState}`,
    view,
    input: { basemapMissing: false, boundaryReady: false, active3d: false },
    expected: VISIBILITY[view].fallback,
  })),
  ...BOUNDARY_STATES.map((boundaryState) => ({
    name: `${view} / 배경지도 없음 / 경계 ${boundaryState}`,
    view,
    input: {
      basemapMissing: true,
      boundaryReady: boundaryState === "ready",
      active3d: false,
    },
    expected: VISIBILITY[view].fallback,
  })),
]);

describe("deriveLayerVisibility", () => {
  it.each(layerCases)("$name", ({ view, input, expected }) => {
    expect(deriveLayerVisibility(view, input)).toEqual(expected);
  });
});

const BOUNDARY_NOTICE: Record<BoundaryState, string | null> = {
  loading: "시군구 경계를 불러오는 중입니다.",
  ready: null,
  missing: "시군구 경계 파일을 읽지 못해 2km 격자로 표시합니다.",
  unconnected: "유효한 지역별 지도 값 또는 정확한 경계 코드 조인이 없어 2km 격자로 표시합니다.",
};

const noticeCases = VIEWS.flatMap((view) => BOUNDARY_STATES.flatMap((boundaryState) => [
  {
    name: `${view} / 배경지도 있음 / 경계 ${boundaryState}`,
    view,
    basemapMissing: false,
    boundaryState,
    expected: view === "bubble" ? null : BOUNDARY_NOTICE[boundaryState],
  },
  {
    name: `${view} / 배경지도 없음 / 경계 ${boundaryState}`,
    view,
    basemapMissing: true,
    boundaryState,
    expected: view === "bubble"
      ? "배경지도를 불러오지 못했습니다. 밀집 원만 표시합니다."
      : "배경지도를 불러오지 못해 2km 격자로 표시합니다.",
  },
]));

describe("deriveFallbackNotice", () => {
  it.each(noticeCases)("$name", ({ view, basemapMissing, boundaryState, expected }) => {
    expect(deriveFallbackNotice(view, basemapMissing, boundaryState)).toBe(expected);
  });
});
