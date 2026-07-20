<!-- Parent: ../AGENTS.md -->

# data/ref

## Purpose

파이프라인이 조인에 쓰는 커밋된 참조 자산. `data/raw/`·`data/processed/`와 달리 기준일에 고정된 코드 매핑·경계 좌표계라서 커밋 대상이다(`.gitignore`가 이 디렉터리는 제외하지 않는다).

## Key Files

| File | Description |
|------|--------------|
| `zscode_map.csv` | 시군구 코드 230개 (`zscode` → `zcode`/시도명/시군구명). `scripts/build_ref.py`가 OpenAPI 활용가이드(.docx)에서 생성 |
| `sido_name_map.csv` | 한전 축약 시도명(예: "강원") 17개 → 행정구역 정식명/`zcode`. `scripts/build_ref.py` 생성 |
| `zscode_bridge.csv` | 전남광주통합특별시(zcode 12) 27개 시군구 → 레거시 광주(29)/전남(46) 매핑, 27행. `scripts/build_bridge.py`가 최신 스냅샷에서 자동 생성 |
| `sigungu.topo.json` | 코로플레스 지도용 시군구 경계 TopoJSON(229개 물리 경계, WGS84). 국가데이터처 SGIS 2025-06-30 원본을 단순화·재투영한 산출물 |
| `sigungu.topo.json.LICENSE` | 위 TopoJSON의 출처 URL, 기준일, 이용허락범위, 변환 명령, 해시 기록 |

## For AI Agents

### Working In This Directory

- `zscode_map.csv`/`sido_name_map.csv`를 직접 편집하지 않는다. 활용가이드가 개정되면 `python scripts/build_ref.py --docx <path>`로 재생성한다.
- `zscode_bridge.csv`는 최신 충전소 스냅샷(`data/raw/chargers_*.parquet`)에서 `python scripts/build_bridge.py`로 재생성한다. 1:1 대응이 깨지면 스크립트가 즉시 실패한다.
- `sigungu.topo.json`을 갱신하려면 반드시 `sigungu.topo.json.LICENSE`도 함께 갱신한다 — 라이선스 확인 전에는 커밋하지 않는다(`docs/adr/0001-sigungu-boundary-and-3d-map.md`).
- 대구 군위(`27720`)와 폐지된 경북 군위(`47720`)가 `zscode_map.csv`에 동시에 있지만 물리 경계는 `27720` 하나뿐이다. 화면 경계 어댑터가 `47720 → 27720` 별칭을 처리한다.

### Testing Requirements

- `tests/test_ref.py` — 17개 시도 전부 매칭되는지 검증.
- `tests/test_region_bridge.py` — 브리지 27행이 레거시 시군구와 1:1 대응하는지 검증.
- `tests/test_boundary_asset.py` — TopoJSON의 229개 물리 경계, 세종 `36110`, 파일 크기 상한, 좌표 범위, 도서 지역 보존을 검증.

## Dependencies

### Internal
- 생성: `scripts/build_ref.py`(zscode_map, sido_name_map), `scripts/build_bridge.py`(zscode_bridge)
- 소비: `src/clean.py`(zscode_bridge로 지역코드 정규화), `src/metrics.py`(zscode_map으로 시군구 조인), `scripts/build_web_data.py`(zscode_map으로 지역 기준표 생성, sigungu.topo.json을 `prototype/public/data/`로 복사)
