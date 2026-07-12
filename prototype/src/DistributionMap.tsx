/**
 * 2D 격자 밀도 지도. 3D 기둥은 쓰지 않는다 -- 원근이 비교를 왜곡한다(DESIGN.md).
 *
 * 충전 데이터는 로컬 정적 파일만 쓰고, 외부 통신은 배경지도 타일뿐이다.
 * 두 경계는 화면에도 표시된다.
 */
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { Cell } from "./data";

/** CARTO Positron: 토큰 없이 쓸 수 있는 배경지도(=유일한 외부 통신). */
const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const SOURCE = "cells";

export type MapView = "grid" | "heat";

interface Props {
  cells: Cell[];
  view: MapView;
  gridDeg: number;
}

function toGeoJson(cells: Cell[], deg: number): GeoJSON.FeatureCollection {
  const h = deg / 2;
  return {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      properties: { count: c.count },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [c.lng - h, c.lat - h],
            [c.lng + h, c.lat - h],
            [c.lng + h, c.lat + h],
            [c.lng - h, c.lat + h],
            [c.lng - h, c.lat - h],
          ],
        ],
      },
    })),
  };
}

export default function DistributionMap({ cells, view, gridDeg }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);

  useEffect(() => {
    if (!box.current || map.current) return;

    const m = new maplibregl.Map({
      container: box.current,
      style: BASEMAP,
      center: [127.8, 36.2],
      zoom: 5.9,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // 지도 자체는 키보드로 조작 가능하지만, 지도 없이도 같은 집계를 표로 읽을 수 있어야 한다.
    m.getCanvas().setAttribute("aria-label", "충전기 밀도 격자 지도. 같은 집계를 아래 순위 표로도 제공합니다.");

    m.on("load", () => {
      m.addSource(SOURCE, { type: "geojson", data: toGeoJson([], gridDeg) });

      m.addLayer({
        id: "grid",
        type: "fill",
        source: SOURCE,
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            1, "#dff2f5",
            10, "#8fd9e4",
            50, "#31d7e8",
            200, "#2a7fb8",
            600, "#123f6b",
          ],
          "fill-opacity": 0.82,
        },
      });

      m.addLayer({
        id: "heat",
        type: "heatmap",
        source: SOURCE,
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "count"], 0, 0, 300, 1],
          "heatmap-radius": 18,
          "heatmap-opacity": 0.75,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      m.on("mousemove", "grid", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        m.getCanvas().style.cursor = "pointer";
        popup
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${Number(f.properties.count).toLocaleString("ko-KR")}</strong>기 (2km 셀)`)
          .addTo(m);
      });
      m.on("mouseleave", "grid", () => {
        m.getCanvas().style.cursor = "";
        popup.remove();
      });

      ready.current = true;
      (m.getSource(SOURCE) as maplibregl.GeoJSONSource).setData(toGeoJson(cells, gridDeg));
    });

    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 지도는 한 번만 만든다. 데이터 갱신은 아래 훅.
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJson(cells, gridDeg));
  }, [cells, gridDeg]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    m.setLayoutProperty("grid", "visibility", view === "grid" ? "visible" : "none");
    m.setLayoutProperty("heat", "visibility", view === "heat" ? "visible" : "none");
  }, [view]);

  return <div ref={box} style={{ width: "100%", height: "100%" }} />;
}
