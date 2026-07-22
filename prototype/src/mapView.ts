export type MapView = "region" | "supply" | "grid" | "heat" | "bubble";
export type BoundaryState = "loading" | "ready" | "missing" | "unconnected";

export interface LayerVisibility {
  grid: boolean;
  heat: boolean;
  bubble: boolean;
  choropleth: boolean;
  vulnerability3d: boolean;
}

interface LayerFallbackState {
  basemapMissing: boolean;
  boundaryReady: boolean;
  active3d: boolean;
}

export function deriveLayerVisibility(
  view: MapView,
  { basemapMissing, boundaryReady, active3d }: LayerFallbackState,
): LayerVisibility {
  const fallback = basemapMissing || !boundaryReady;

  return {
    grid: (fallback && view !== "bubble") || view === "grid",
    heat: !fallback && view === "heat",
    // 밀집 원은 격자 셀 수만 쓰고 경계·배경지도에 의존하지 않으므로 fallback 중에도 표시한다.
    bubble: view === "bubble",
    choropleth: !fallback && !active3d && view !== "bubble",
    // 3D는 호출부에서 view === "region"일 때만 활성화되므로(canUse3d), bubble 배제가
    // 불필요해졌다 — active3d가 true면 이미 region 뷰라는 뜻이다.
    vulnerability3d: !fallback && active3d,
  };
}

export function deriveFallbackNotice(
  view: MapView,
  basemapMissing: boolean,
  boundaryState: BoundaryState,
): string | null {
  // 밀집 원 뷰는 시군구 경계를 쓰지 않으므로 경계 관련 강등 문구를 내지 않는다.
  // 배경지도만 없을 때는 원 위치의 지리적 맥락이 빠진다는 사실만 알린다.
  if (view === "bubble") {
    return basemapMissing ? "배경지도를 불러오지 못했습니다. 밀집 원만 표시합니다." : null;
  }
  if (basemapMissing) return "배경지도를 불러오지 못해 2km 격자로 표시합니다.";

  switch (boundaryState) {
    case "loading":
      return "시군구 경계를 불러오는 중입니다.";
    case "ready":
      return null;
    case "missing":
      return "시군구 경계 파일을 읽지 못해 2km 격자로 표시합니다.";
    case "unconnected":
      return "유효한 지역별 지도 값 또는 정확한 경계 코드 조인이 없어 2km 격자로 표시합니다.";
  }
}
