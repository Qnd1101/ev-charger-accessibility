"""배포용 시군구 TopoJSON의 물리 경계 계약을 검증한다."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pandas as pd
import pytest

from conftest import REF_DIR


ASSET_PATH = REF_DIR / "sigungu.topo.json"
LEGACY_GUNWI = 47720
CURRENT_GUNWI = 27720
ISLAND_CODES = {28720, 47940, 50110, 50130}


def _geometries(topology: dict) -> list[dict]:
    collection = next(iter(topology["objects"].values()))
    return collection["geometries"]


def _decoded_bounds(topology: dict) -> tuple[float, float, float, float]:
    scale = topology["transform"]["scale"]
    translate = topology["transform"]["translate"]
    xs: list[float] = []
    ys: list[float] = []
    for arc in topology["arcs"]:
        x = y = 0
        for dx, dy in arc:
            x += dx
            y += dy
            xs.append(x * scale[0] + translate[0])
            ys.append(y * scale[1] + translate[1])
    return min(xs), max(xs), min(ys), max(ys)


def _assert_boundary_contract(topology: dict, size: int) -> None:
    geometries = _geometries(topology)
    codes = [int(geometry["properties"]["zscode"]) for geometry in geometries]
    mapped_codes = set(
        pd.read_csv(REF_DIR / "zscode_map.csv", dtype={"zscode": int})["zscode"]
    )
    expected_physical_codes = mapped_codes - {LEGACY_GUNWI}

    assert size < 600_000
    assert len(geometries) == len(set(codes)) == 229
    assert set(codes) == expected_physical_codes
    assert CURRENT_GUNWI in codes and LEGACY_GUNWI not in codes
    assert 36110 in codes

    west, east, south, north = _decoded_bounds(topology)
    assert 124.5 <= west <= east <= 131.9
    assert 33.0 <= south <= north <= 38.7

    types = {
        int(geometry["properties"]["zscode"]): geometry["type"]
        for geometry in geometries
    }
    assert {code for code in ISLAND_CODES if types.get(code) == "MultiPolygon"} == ISLAND_CODES


def test_sigungu_topojson_satisfies_public_asset_contract() -> None:
    topology = json.loads(ASSET_PATH.read_text(encoding="utf-8"))
    _assert_boundary_contract(topology, ASSET_PATH.stat().st_size)


@pytest.mark.parametrize("defect", ["missing", "legacy_duplicate", "bad_crs", "lost_islands"])
def test_boundary_contract_rejects_injected_defects(defect: str) -> None:
    topology = json.loads(ASSET_PATH.read_text(encoding="utf-8"))
    broken = deepcopy(topology)
    geometries = _geometries(broken)

    if defect == "missing":
        geometries.pop()
    elif defect == "legacy_duplicate":
        duplicate = deepcopy(next(g for g in geometries if int(g["properties"]["zscode"]) == CURRENT_GUNWI))
        duplicate["properties"]["zscode"] = LEGACY_GUNWI
        geometries.append(duplicate)
    elif defect == "bad_crs":
        broken["transform"]["translate"][0] = 200
    else:
        next(g for g in geometries if int(g["properties"]["zscode"]) == 28720)["type"] = "Polygon"

    with pytest.raises(AssertionError):
        _assert_boundary_contract(broken, ASSET_PATH.stat().st_size)
