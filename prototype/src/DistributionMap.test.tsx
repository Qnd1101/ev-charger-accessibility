import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import DistributionMap from "./DistributionMap";

const mapBoundary = vi.hoisted(() => ({
  styles: [] as unknown[],
  layoutChanges: [] as Array<[string, string, unknown]>,
  zoom: 8,
}));

vi.mock("maplibre-gl", () => {
  class Map {
    private listeners = new globalThis.Map<string, Array<() => void>>();
    private layers = new Set<string>();
    private sources = new globalThis.Map<string, { setData: ReturnType<typeof vi.fn> }>();
    dragRotate = { disable: vi.fn() };
    touchZoomRotate = { disableRotation: vi.fn() };

    constructor(options: { style: unknown }) {
      mapBoundary.styles.push(options.style);
      if (typeof options.style !== "string") {
        queueMicrotask(() => {
          this.emit("load");
          this.emit("zoomend");
        });
      }
    }

    on(event: string, layerOrHandler: string | (() => void), handler?: () => void) {
      const listener = typeof layerOrHandler === "function" ? layerOrHandler : handler;
      if (listener) this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    private emit(event: string) {
      for (const listener of this.listeners.get(event) ?? []) listener();
    }

    addControl() { return this; }
    getCanvas() { return document.createElement("canvas"); }
    getZoom() { return mapBoundary.zoom; }
    getBearing() { return 0; }
    setBearing() { return this; }
    easeTo() { return this; }
    remove() {}
    addSource(id: string) { this.sources.set(id, { setData: vi.fn() }); }
    getSource(id: string) { return this.sources.get(id); }
    removeSource(id: string) { this.sources.delete(id); }
    addLayer(layer: { id: string }) { this.layers.add(layer.id); }
    getLayer(id: string) { return this.layers.has(id) ? { id } : undefined; }
    removeLayer(id: string) { this.layers.delete(id); }
    setPaintProperty() {}
    setLayoutProperty(id: string, name: string, value: unknown) {
      mapBoundary.layoutChanges.push([id, name, value]);
    }
  }

  class Popup {
    setLngLat() { return this; }
    setText() { return this; }
    addTo() { return this; }
    remove() {}
  }

  return {
    default: {
      Map,
      NavigationControl: class {},
      Popup,
    },
  };
});

beforeEach(() => {
  mapBoundary.styles.length = 0;
  mapBoundary.layoutChanges.length = 0;
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("외부 배경지도 스타일을 받지 못해도 로컬 2km 격자 fallback으로 전환한다", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("blocked")));

  render(
    <DistributionMap
      cells={[{ lat: 37.5, lng: 127, count: 3 }]}
      view="region"
      gridDeg={0.018}
      boundaryUrl="/data/missing.topo.json"
    />,
  );

  expect(screen.getByRole("status")).toHaveTextContent("시군구 경계를 불러오는 중입니다.");
  expect(await screen.findByText("배경지도를 불러오지 못해 2km 격자로 표시합니다.")).toBeVisible();
  await waitFor(() => {
    expect(mapBoundary.layoutChanges).toContainEqual(["grid", "visibility", "visible"]);
  });
});

it("배경지도와 경계가 정상이면 코로플레스와 제한된 3D 동작을 유지한다", async () => {
  const basemapStyle = { version: 8, sources: {}, layers: [] };
  const boundaries = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { SIG_CD: "11110" },
      geometry: { type: "Polygon", coordinates: [] },
    }],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    json: async () => String(input).includes("cartocdn.com") ? basemapStyle : boundaries,
  })));

  render(
    <DistributionMap
      cells={[{ lat: 37.5, lng: 127, count: 3 }]}
      view="region"
      gridDeg={0.018}
      boundaryUrl="/data/sigungu.topo.json"
      regionValues={[{ zscode: 11110, value: 4, vulnerability: 2 }]}
      fixedVulnerabilityMax={10}
    />,
  );

  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(mapBoundary.styles).toContainEqual(basemapStyle);
  expect(mapBoundary.layoutChanges).toContainEqual(["choropleth", "visibility", "visible"]);

  const button = screen.getByRole("button", { name: "3D 취약도" });
  await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "false"));
  fireEvent.click(button);
  await waitFor(() => {
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(mapBoundary.layoutChanges).toContainEqual(["vulnerability-3d", "visibility", "visible"]);
  });
});
