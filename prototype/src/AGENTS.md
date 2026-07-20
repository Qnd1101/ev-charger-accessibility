<!-- Parent: ../AGENTS.md -->

# prototype/src

## Purpose

Split Command 화면의 React 컴포넌트와 클라이언트 데이터 레이어. 정적 JSON을 로드·집계하고, Python이 내보낸 지표 정의를 평가해 화면을 그린다.

## Key Files

| File | Description |
|------|--------------|
| `main.tsx` | React 앱 엔트리포인트 |
| `App.tsx` | 최상위 화면 컴포넌트. 필터 상태(시도/속도/운영기관/24시간), KPI, 랭킹(M1/M2 토글), 빈 결과 안내, 복구 가능 조건 계산을 모두 담당 |
| `App.module.css` | `App.tsx` 스타일 |
| `data.ts` | 정적 집계 로딩(`loadDataset`)과 필터별 재집계(`aggregateRegions`, `aggregateGrid`, `totalTerms`). **지표 공식은 없다** — 큐브 값을 더하기만 한다 |
| `metrics.ts` | 지표 평가기(`evaluate`, `format`, `isVulnerableFirst`, `byId`). `metrics.json`을 읽어 나눗셈만 수행하고 공식 자체는 없다 |
| `DistributionMap.tsx` | 시군구 코로플레스(기본) + 2km 격자 보조 오버레이 지도. MapLibre GL 기반, 조건부 3D(ADR 0001 여섯 제약 준수) |
| `DistributionMap.module.css` | 지도 스타일 |
| `mapBoundary.ts` | `sigungu.topo.json`을 MapLibre가 읽는 GeoJSON으로 변환하는 TopoJSON 로더. 군위 `47720→27720` 별칭 처리, 모호한 조인 거부 |
| `RankingChart.tsx` | 취약 지역 랭킹 막대 차트(echarts). 표와 같은 배열을 그려 교차 검증 가능 |
| `DataProvenance.tsx` | `docs/data-sources.md`를 파싱해 데이터 출처 패널을 렌더링 |
| `DataProvenance.module.css` | 위 컴포넌트 스타일 |
| `tokens.css` | 디자인 토큰(색상·타이포그래피 등 CSS 커스텀 프로퍼티) |
| `*.test.tsx`, `*.test.ts` | Vitest 단위 테스트 (App, DataProvenance, DistributionMap, mapBoundary) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `test/` | Vitest 전역 셋업 (see `test/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- `data.ts`와 `metrics.ts`에 나눗셈/공식을 새로 추가하지 않는다. 새 지표는 `src/metric_specs.py`(Python)에서 정의하고 `metrics.json`으로 내보낸 뒤 이 레이어는 `byId`로 참조만 한다.
- 큐브(`regionCube`, `gridCube`)의 원소 순서는 배열 튜플이다(`[zscode, opIdx, speed, h24, chargers, stations, fast, live, available]` 등). Python 쪽(`scripts/build_web_data.py`)과 순서가 어긋나면 값이 조용히 틀어진다 — 둘을 항상 함께 바꾼다.
- `DistributionMap.tsx`의 3D 기둥은 ADR 0001의 여섯 제약(기본값 아님, 이중 부호화, 카메라 구속, 고정 높이 도메인, 줌 게이트, 자기 고지)을 모두 지켜야 한다. 하나라도 깨면 3D를 다시 금지해야 한다.
- `mapBoundary.ts`가 두 코드(`27720`/`47720`)에 값이 동시에 있으면 모호한 조인으로 거부해야 한다 — 조용히 하나를 선택하지 않는다.

### Testing Requirements

```bash
npm run test        # vitest run (jsdom)
npm run typecheck
```
- 새 컴포넌트/로직 추가 시 인접한 `*.test.tsx`/`*.test.ts` 파일에 케이스를 추가한다(파일명 컨벤션: `Foo.tsx` ↔ `Foo.test.tsx`).
- 지도·시각적 렌더 검증은 `prototype/e2e/tests`(Playwright)가 담당한다 — 여기 단위 테스트는 순수 로직/DOM 계약에 집중한다.

### Common Patterns

- 컴포넌트는 named export 없이 `export default function ComponentName()` 형태.
- 스타일은 컴포넌트별 CSS Module(`import s from "./X.module.css"`).
- 필드 이름은 Python `metric_specs.COUNT_FIELDS`/`REGION_FIELDS`와 동일해야 하는 계약이 `data.ts`/`metrics.ts` 전반에 걸쳐 있다.

## Dependencies

### Internal
- `prototype/public/data/*.json` (런타임 fetch 대상)
- `docs/data-sources.md` (`DataProvenance.tsx`가 `?raw` 임포트)

### External
- `react`, `maplibre-gl`, `echarts`(`echarts/core` + 개별 차트/렌더러 모듈만 임포트 — 전체 패키지 임포트는 번들 크기 회귀, `prototype/scripts/check-bundle-size.mjs` 참고)
