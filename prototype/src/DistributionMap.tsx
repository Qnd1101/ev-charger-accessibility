/** 시군구 코로플레스와 사용자가 선택하는 2km 격자 보조 오버레이. */
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import type { Cell } from "./data";
import s from "./DistributionMap.module.css";
import {
  boundaryJoinIsExact,
  getThreeDimensionalAvailability,
  hasUsableBoundaryValues,
  inspectBoundaryJoin,
  joinBoundaryValues,
  loadSigunguBoundaries,
  type BoundaryValue,
} from "./mapBoundary";

const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const GRID_SOURCE = "cells";
const BUBBLE_SOURCE = "cell-points";
const REGION_SOURCE = "sigungu";
const MIN_3D_ZOOM = 7;
const MOBILE_QUERY = "(max-width: 767px)";
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const THREE_D_REASON_ID = "distribution-map-3d-reason";
const LOCAL_FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{
    id: "fallback-background",
    type: "background",
    paint: { "background-color": "#eef3f6" },
  }],
};

export type MapView = "region" | "supply" | "grid" | "heat" | "bubble";

interface Props {
  cells: Cell[];
  view: MapView;
  gridDeg: number;
  /** Python 지표 산출물에서 계산된 표시 값과 취약도. UI는 둘을 재계산하지 않는다. */
  regionValues?: BoundaryValue[];
  /** 시군구별 충전기 수. 부족도와 다른, 공급 분포 전용 값이다. */
  supplyValues?: BoundaryValue[];
  /** 무필터 전국 취약도의 고정 최댓값. 필터가 바뀌어도 같은 값을 전달해야 한다. */
  fixedVulnerabilityMax?: number;
  boundaryUrl?: string;
}

type BoundaryState = "loading" | "ready" | "missing" | "unconnected";

function toGridGeoJson(cells: Cell[], deg: number): GeoJSON.FeatureCollection {
  const half = deg / 2;
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => ({
      type: "Feature",
      properties: { count: cell.count },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [cell.lng - half, cell.lat - half],
          [cell.lng + half, cell.lat - half],
          [cell.lng + half, cell.lat + half],
          [cell.lng - half, cell.lat + half],
          [cell.lng - half, cell.lat - half],
        ]],
      },
    })),
  };
}

/**
 * 비례 원(밀집) 뷰용 점 피처. 격자 셀 중심에 충전기 수를 실어 원 하나로 그린다.
 * circle 레이어는 폴리곤 꼭짓점마다 원을 그리므로, 격자 폴리곤을 재활용하지 않고
 * 셀 중심 점을 따로 만든다.
 */
function toCellPoints(cells: Cell[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => ({
      type: "Feature",
      properties: { count: cell.count },
      geometry: { type: "Point", coordinates: [cell.lng, cell.lat] },
    })),
  };
}

// 원 반지름은 넓이가 아니라 반지름이 눈에 먼저 들어오므로 sqrt 에 가깝게 눌러 키운다.
// 정확한 비교가 아니라 "어디에 압도적으로 몰렸나"를 보는 탐색용이다(아래 disclosure 문구).
const BUBBLE_RADIUS: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["get", "count"],
  1, 3, 10, 6, 50, 12, 200, 22, 600, 34,
];

function vulnerabilityColor(max: number): maplibregl.ExpressionSpecification {
  return [
    "case",
    ["!", ["has", "vulnerability"]],
    "#9aa4ad",
    ["interpolate", ["linear"], ["get", "vulnerability"], 0, "#dff2f5", max, "#ffbd59"],
  ];
}

function vulnerabilityHeight(max: number): maplibregl.ExpressionSpecification {
  return [
    "case",
    ["!", ["has", "vulnerability"]],
    0,
    ["interpolate", ["linear"], ["get", "vulnerability"], 0, 0, max, 180000],
  ];
}

function supplyColor(max: number): maplibregl.ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["get", "value"],
    0, "#e8f3ff", max, "#3182f6",
  ];
}

function setVisibility(map: MapLibreMap, id: string, visible: boolean) {
  if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

export default function DistributionMap({
  cells,
  view,
  gridDeg,
  regionValues = [],
  supplyValues = [],
  fixedVulnerabilityMax,
  boundaryUrl = `${import.meta.env.BASE_URL}data/sigungu.topo.json`,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const boundaries = useRef<GeoJSON.FeatureCollection | null>(null);
  const fixedDomain = useRef<number | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [basemapMissing, setBasemapMissing] = useState(false);
  const [geometryLoaded, setGeometryLoaded] = useState(false);
  const [boundaryState, setBoundaryState] = useState<BoundaryState>("loading");
  const [zoom, setZoom] = useState(5.9);
  const [is3d, setIs3d] = useState(false);
  const [motionReduced, setMotionReduced] = useState(false);
  const [mobile, setMobile] = useState(false);

  if (fixedDomain.current === null && Number.isFinite(fixedVulnerabilityMax) && (fixedVulnerabilityMax ?? 0) > 0) {
    fixedDomain.current = fixedVulnerabilityMax!;
  }
  const vulnerabilityMax = fixedDomain.current;
  const availability = getThreeDimensionalAvailability({
    boundariesReady: boundaryState === "ready" && !basemapMissing,
    hasFixedDomain: vulnerabilityMax !== null,
    motionReduced,
    mobile,
    zoom,
    minZoom: MIN_3D_ZOOM,
  });
  const canUse3d = view === "region" && availability.allowed;
  const threeDimensionalReason = view !== "region"
    ? "3D는 부족도 보기에서만 제공합니다. 지역별 충전기 수는 색과 목록으로 비교하세요."
    : availability.reason;
  const activeBoundaryValues = view === "supply" ? supplyValues : regionValues;
  const supplyMax = Math.max(1, ...supplyValues.map(({ value }) => value ?? 0));

  useEffect(() => {
    const reduced = window.matchMedia(MOTION_QUERY);
    const narrow = window.matchMedia(MOBILE_QUERY);
    const sync = () => {
      setMotionReduced(reduced.matches);
      setMobile(narrow.matches);
    };
    sync();
    reduced.addEventListener("change", sync);
    narrow.addEventListener("change", sync);
    return () => {
      reduced.removeEventListener("change", sync);
      narrow.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!box.current || map.current) return;
    const controller = new AbortController();
    let cancelled = false;
    let instance: MapLibreMap | null = null;

    const start = async () => {
      let style: maplibregl.StyleSpecification;
      try {
        const response = await fetch(BASEMAP, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        style = await response.json() as maplibregl.StyleSpecification;
      } catch {
        if (cancelled) return;
        style = LOCAL_FALLBACK_STYLE;
        setBasemapMissing(true);
      }
      if (cancelled) return;

      instance = new maplibregl.Map({
        container: box.current!,
        style,
        center: [127.8, 36.2],
        zoom: 5.9,
        bearing: 0,
        pitch: 0,
        maxPitch: 45,
        attributionControl: { compact: true },
      });
      instance.dragRotate.disable();
      instance.touchZoomRotate.disableRotation();
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      instance.getCanvas().setAttribute(
        "aria-label",
        "충전 인프라 지역 지도. 같은 집계를 뒤따르는 순위 표에서도 제공합니다.",
      );
      instance.on("zoomend", () => setZoom(instance!.getZoom()));
      instance.on("rotate", () => {
        if (instance!.getBearing() !== 0) instance!.setBearing(0);
      });
      instance.on("load", () => {
        instance!.addSource(GRID_SOURCE, { type: "geojson", data: toGridGeoJson(cells, gridDeg) });
        instance!.addLayer({
          id: "grid",
          type: "fill",
          source: GRID_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "fill-color": ["interpolate", ["linear"], ["get", "count"], 1, "#dff2f5", 10, "#8fd9e4", 50, "#31d7e8", 200, "#2a7fb8", 600, "#123f6b"],
            "fill-opacity": 0.62,
            "fill-outline-color": "rgba(7, 17, 31, 0.18)",
          },
        });
        instance!.addLayer({
          id: "heat",
          type: "heatmap",
          source: GRID_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "count"], 0, 0, 300, 1],
            "heatmap-radius": 18,
            "heatmap-opacity": 0.7,
          },
        });
        instance!.addSource(BUBBLE_SOURCE, { type: "geojson", data: toCellPoints(cells) });
        // 밀집 원: 색(정보 시안)은 고정하고 크기로만 충전기 수를 인코딩한다. 취약도의 앰버와
        // 겹치지 않게 해 "부족"과 "밀집"의 색 신호를 분리한다(DESIGN.md 시각 언어).
        instance!.addLayer({
          id: "bubble",
          type: "circle",
          source: BUBBLE_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "circle-radius": BUBBLE_RADIUS,
            "circle-color": "#31d7e8",
            "circle-opacity": 0.5,
            "circle-stroke-color": "#07111f",
            "circle-stroke-width": 1,
          },
        });
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
        const showCount = (event: maplibregl.MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature) return;
          instance!.getCanvas().style.cursor = "pointer";
          popup.setLngLat(event.lngLat)
            .setText(`${Number(feature.properties.count).toLocaleString("ko-KR")}기 (2km 셀)`)
            .addTo(instance!);
        };
        const hideCount = () => {
          instance!.getCanvas().style.cursor = "";
          popup.remove();
        };
        for (const layer of ["grid", "bubble"]) {
          instance!.on("mousemove", layer, showCount);
          instance!.on("mouseleave", layer, hideCount);
        }
        setMapLoaded(true);
      });
      map.current = instance;
    };
    void start();

    return () => {
      cancelled = true;
      controller.abort();
      instance?.remove();
      map.current = null;
    };
    // 지도 인스턴스는 한 번만 만들고 데이터는 각 source에 갱신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapLoaded) return;
    (instance.getSource(GRID_SOURCE) as maplibregl.GeoJSONSource).setData(toGridGeoJson(cells, gridDeg));
    (instance.getSource(BUBBLE_SOURCE) as maplibregl.GeoJSONSource).setData(toCellPoints(cells));
    setIs3d(false);
  }, [cells, gridDeg, mapLoaded]);

  // 정적 경계의 fetch/decode/source 설치는 필터 값 변경과 분리해 URL당 한 번만 수행한다.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapLoaded) return;
    let cancelled = false;
    setBoundaryState("loading");
    setGeometryLoaded(false);
    const install = async () => {
      try {
        const collection = await loadSigunguBoundaries(boundaryUrl);
        if (cancelled) return;
        boundaries.current = collection;
        const initial = joinBoundaryValues(collection, []);
        instance.addSource(REGION_SOURCE, { type: "geojson", data: initial });
        const max = vulnerabilityMax ?? 1;
        instance.addLayer({
          id: "choropleth",
          type: "fill",
          source: REGION_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "fill-color": vulnerabilityColor(max),
            "fill-opacity": 0.8,
            "fill-outline-color": "#07111f",
          },
        }, "grid");
        instance.addLayer({
          id: "vulnerability-3d",
          type: "fill-extrusion",
          source: REGION_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "fill-extrusion-color": vulnerabilityColor(max),
            "fill-extrusion-height": vulnerabilityHeight(max),
            "fill-extrusion-opacity": 0.86,
          },
        }, "grid");
        setGeometryLoaded(true);
      } catch {
        if (!cancelled) setBoundaryState("missing");
      }
    };
    void install();
    return () => {
      cancelled = true;
      boundaries.current = null;
      if (map.current !== instance) return;
      if (instance.getLayer("vulnerability-3d")) instance.removeLayer("vulnerability-3d");
      if (instance.getLayer("choropleth")) instance.removeLayer("choropleth");
      if (instance.getSource(REGION_SOURCE)) instance.removeSource(REGION_SOURCE);
    };
  }, [boundaryUrl, mapLoaded]);

  // 필터 변경은 이미 설치된 source의 속성만 바꾼다. 경계 파일을 다시 받지 않는다.
  useEffect(() => {
    const instance = map.current;
    const collection = boundaries.current;
    if (!instance || !geometryLoaded || !collection) return;
    const contract = inspectBoundaryJoin(collection, activeBoundaryValues);
    const usable = hasUsableBoundaryValues(activeBoundaryValues) && boundaryJoinIsExact(contract);
    (instance.getSource(REGION_SOURCE) as maplibregl.GeoJSONSource).setData(
      joinBoundaryValues(collection, usable ? activeBoundaryValues : []),
    );
    setBoundaryState(usable ? "ready" : "unconnected");
    setIs3d(false);
  }, [activeBoundaryValues, geometryLoaded]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !geometryLoaded || vulnerabilityMax === null) return;
    instance.setPaintProperty("choropleth", "fill-color", view === "supply" ? supplyColor(supplyMax) : vulnerabilityColor(vulnerabilityMax));
    instance.setPaintProperty("vulnerability-3d", "fill-extrusion-color", vulnerabilityColor(vulnerabilityMax));
    instance.setPaintProperty("vulnerability-3d", "fill-extrusion-height", vulnerabilityHeight(vulnerabilityMax));
  }, [geometryLoaded, supplyMax, view, vulnerabilityMax]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapLoaded) return;
    const active3d = is3d && canUse3d;
    if (is3d && !canUse3d) setIs3d(false);
    const fallback = basemapMissing || boundaryState !== "ready";
    setVisibility(instance, "grid", (fallback && view !== "bubble") || view === "grid");
    setVisibility(instance, "heat", !fallback && view === "heat");
    // 밀집 원은 격자 셀 수만 쓰고 경계·배경지도에 의존하지 않으므로 fallback 중에도 표시한다.
    setVisibility(instance, "bubble", view === "bubble");
    setVisibility(instance, "choropleth", !fallback && !active3d && view !== "bubble");
    setVisibility(instance, "vulnerability-3d", !fallback && active3d);
    instance.easeTo({ bearing: 0, pitch: active3d ? 45 : 0, duration: motionReduced ? 0 : 450 });
  }, [basemapMissing, boundaryState, canUse3d, is3d, mapLoaded, motionReduced, view]);

  // 밀집 원 뷰는 시군구 경계를 쓰지 않으므로 경계 관련 강등 문구를 내지 않는다.
  // 배경지도만 없을 때는 원 위치의 지리적 맥락이 빠진다는 사실만 알린다.
  const bubbleBanner = view === "bubble" && basemapMissing;
  const fallbackMessage = view === "bubble"
    ? "배경지도를 불러오지 못했습니다. 밀집 원만 표시합니다."
    : basemapMissing
      ? "배경지도를 불러오지 못해 2km 격자로 표시합니다."
      : boundaryState === "loading"
        ? "시군구 경계를 불러오는 중입니다."
        : boundaryState === "missing"
          ? "시군구 경계 파일을 읽지 못해 2km 격자로 표시합니다."
          : "유효한 지역별 지도 값 또는 정확한 경계 코드 조인이 없어 2km 격자로 표시합니다.";
  const showBanner = view === "bubble" ? bubbleBanner : basemapMissing || boundaryState !== "ready";

  return (
    <div className={s.root}>
      <div ref={box} className={s.map} />
      {showBanner && <p role="status" className={s.status}>{fallbackMessage}</p>}
      <div className={s.controls}>
        {/* 비활성 이유는 srOnly 라 스크린리더에만 닿는다. title 로 마우스 사용자에게도 노출한다. */}
        <button
          type="button"
          className={s.modeButton}
          aria-pressed={is3d}
          aria-disabled={!canUse3d}
          aria-describedby={!canUse3d ? THREE_D_REASON_ID : undefined}
          title={!canUse3d ? threeDimensionalReason : undefined}
          onClick={() => {
            if (canUse3d) setIs3d((value) => !value);
          }}
        >
          3D 취약도
        </button>
        {!canUse3d && <p id={THREE_D_REASON_ID} className={s.srOnly}>{threeDimensionalReason}</p>}
        {is3d && (
          <p role="note" className={s.disclosure}>
            높이는 탐색용입니다. 정확한 비교는 순위 표를 사용하세요.
          </p>
        )}
      </div>
    </div>
  );
}
