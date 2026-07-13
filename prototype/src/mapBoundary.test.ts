import { describe, expect, it } from "vitest";

import {
  boundaryJoinIsExact,
  getThreeDimensionalAvailability,
  hasUsableBoundaryValues,
  inspectBoundaryJoin,
  joinBoundaryValues,
  topologyToFeatureCollection,
} from "./mapBoundary";

describe("시군구 지도 공개 계약", () => {
  it("TopoJSON의 누적 좌표와 역방향 호를 실제 GeoJSON 좌표로 복원한다", () => {
    const collection = topologyToFeatureCollection({
      type: "Topology",
      transform: { scale: [0.1, 0.1], translate: [126, 35] },
      arcs: [
        [[0, 0], [10, 0], [0, 10]],
        [[0, 0], [0, 10]],
      ],
      objects: {
        sigungu: {
          type: "GeometryCollection",
          geometries: [{ type: "Polygon", arcs: [[0, -2]], properties: { SIG_CD: "11110" } }],
        },
      },
    });

    expect(collection.features[0].geometry).toEqual({
      type: "Polygon",
      coordinates: [[[126, 35], [127, 35], [127, 36], [126, 35]]],
    });
  });

  it("경계 코드를 Python 산출 값과 조인하고 취약도 원본을 그대로 보존한다", () => {
    const joined = joinBoundaryValues({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { SIG_CD: "11110" },
        geometry: { type: "Polygon", coordinates: [] },
      }],
    }, [{ zscode: 11110, value: 12.4, vulnerability: 8.75 }]);

    expect(joined.features[0].properties).toMatchObject({
      zscode: 11110,
      value: 12.4,
      vulnerability: 8.75,
    });
  });

  it("값이 없는 경계를 취약도 0으로 위장하지 않는다", () => {
    const joined = joinBoundaryValues({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { SIG_CD: "11110" },
        geometry: { type: "Polygon", coordinates: [] },
      }],
    }, []);

    expect(joined.features[0].properties).toMatchObject({
      zscode: 11110,
      value: null,
    });
    expect(joined.features[0].properties).not.toHaveProperty("vulnerability");
  });

  it("현행 군위 경계 하나에 값 없는 레거시 코드가 함께 있어도 정확히 조인한다", () => {
    const boundaries: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { zscode: 27720 },
        geometry: { type: "Polygon", coordinates: [] },
      }],
    };
    const values = [
      { zscode: 27720, value: 897.4, vulnerability: 20 },
      { zscode: 47720, value: null, vulnerability: null },
    ];

    expect(boundaryJoinIsExact(inspectBoundaryJoin(boundaries, values))).toBe(true);
    expect(joinBoundaryValues(boundaries, values).features[0].properties).toMatchObject({
      zscode: 27720,
      value: 897.4,
      vulnerability: 20,
    });
  });

  it("현행·레거시 군위 코드에 값이 동시에 있으면 모호한 중복 조인을 거부한다", () => {
    const boundaries: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { zscode: 27720 },
        geometry: { type: "Polygon", coordinates: [] },
      }],
    };
    const contract = inspectBoundaryJoin(boundaries, [
      { zscode: 27720, value: 897.4, vulnerability: 20 },
      { zscode: 47720, value: 100, vulnerability: 30 },
    ]);

    expect(contract.duplicateValueCodes).toEqual([27720]);
    expect(boundaryJoinIsExact(contract)).toBe(false);
  });

  it("중복·누락·잉여 코드를 각각 검출해 부정확한 조인을 거부한다", () => {
    const boundaries: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [11110, 11110, 11140].map((code) => ({
        type: "Feature",
        properties: { SIG_CD: String(code) },
        geometry: { type: "Polygon", coordinates: [] },
      })),
    };
    const contract = inspectBoundaryJoin(boundaries, [
      { zscode: 11110, value: 1, vulnerability: 1 },
      { zscode: 11110, value: 2, vulnerability: 2 },
      { zscode: 99999, value: 3, vulnerability: 3 },
    ]);

    expect(contract).toEqual({
      invalidBoundaryFeatureIndexes: [],
      duplicateBoundaryCodes: [11110],
      duplicateValueCodes: [11110],
      missingValueCodes: [11140],
      extraValueCodes: [99999],
    });
    expect(boundaryJoinIsExact(contract)).toBe(false);
  });

  it("코드 없는 경계 feature를 invalid로 검출해 정확한 조인으로 통과시키지 않는다", () => {
    const boundaries: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { SIG_CD: "11110" },
          geometry: { type: "Polygon", coordinates: [] },
        },
        {
          type: "Feature",
          properties: { name: "코드 없음" },
          geometry: { type: "Polygon", coordinates: [] },
        },
      ],
    };
    const contract = inspectBoundaryJoin(boundaries, [
      { zscode: 11110, value: 1, vulnerability: 1 },
    ]);

    expect(contract.invalidBoundaryFeatureIndexes).toEqual([1]);
    expect(boundaryJoinIsExact(contract)).toBe(false);
  });

  it("배열 길이가 있어도 표시 값이 모두 null이면 강등 대상으로 판정한다", () => {
    expect(hasUsableBoundaryValues([
      { zscode: 11110, value: null, vulnerability: null },
      { zscode: 11140, value: null, vulnerability: null },
    ])).toBe(false);
    expect(hasUsableBoundaryValues([
      { zscode: 11110, value: 4.2, vulnerability: 0 },
    ])).toBe(true);
  });

  it.each([
    ["전국 축척", { zoom: 5.9 }, "더 확대"],
    ["모바일", { mobile: true }, "모바일"],
    ["동작 줄이기", { motionReduced: true }, "동작 줄이기"],
    ["고정 도메인 없음", { hasFixedDomain: false }, "고정 취약도"],
    ["경계 없음", { boundariesReady: false }, "경계와 지역 값"],
  ])("%s에서는 3D를 사유와 함께 차단한다", (_name, override, reason) => {
    const result = getThreeDimensionalAvailability({
      boundariesReady: true,
      hasFixedDomain: true,
      motionReduced: false,
      mobile: false,
      zoom: 8,
      minZoom: 7,
      ...override,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(reason);
  });

  it("경계·고정 도메인·화면·줌 제약이 모두 충족될 때만 3D를 허용한다", () => {
    expect(getThreeDimensionalAvailability({
      boundariesReady: true,
      hasFixedDomain: true,
      motionReduced: false,
      mobile: false,
      zoom: 7,
      minZoom: 7,
    })).toEqual({ allowed: true, reason: "" });
  });
});
