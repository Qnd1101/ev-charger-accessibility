<!-- Parent: ../AGENTS.md -->

# prototype

## Purpose

React + Vite + TypeScript 단일 페이지 대시보드. "Split Command" 화면 구조(어두운 고정 필터 레일 + 밝은 분석 캔버스)로, Python 파이프라인이 미리 만든 정적 희소 집계(`public/data/*.json`)만 읽는다 — 브라우저는 원본 51만 건에도, 충전 데이터 API에도 직접 접근하지 않는다. 외부 통신은 배경지도 타일(CARTO Positron)뿐이다. 2026-07-13 구조 승인 이후 기존 Streamlit UI를 대체하는 제품 화면이다.

## Key Files

| File | Description |
|------|--------------|
| `package.json` | 스크립트(`dev`/`build`/`test`/`test:e2e`/`smoke`/`check-bundle-size`)와 의존성(React 18, echarts, maplibre-gl) |
| `index.html` | Vite 엔트리 HTML |
| `vite.config.ts` | Vite 빌드 설정 |
| `vitest.config.ts` | Vitest 단위 테스트 설정(jsdom) |
| `playwright.config.ts` | Playwright E2E 설정 |
| `tsconfig.json` | TypeScript 프로젝트 설정 |
| `smoke.mjs` | 빌드 후 실제 브라우저(Playwright chromium)로 렌더해 KPI가 파이프라인과 같은 값인지, 1440/768/360px에서 가로 스크롤이 없는지 확인하는 스모크 스크립트 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | React 컴포넌트, 데이터 로딩·집계, 지표 평가기 (see `src/AGENTS.md`) |
| `scripts/` | 번들 크기 회귀 감시 스크립트 (see `scripts/AGENTS.md`) |
| `public/` | 정적 자산 루트 — `data/`만 포함 (see `public/AGENTS.md`) |
| `e2e/` | Playwright E2E 테스트와 그 픽스처 생성기 (see `e2e/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- **지표 공식을 이 디렉터리에서 재구현하지 않는다.** `src/metrics.ts`의 `evaluate()`는 `metrics.json`(Python이 내보낸 정의)을 읽어 나누기만 한다. 새 지표가 필요하면 `src/metric_specs.py`(Python)를 먼저 고친다.
- `python scripts/build_web_data.py`를 실행하지 않으면 `public/data/*.json`이 없거나 오래된 상태다. 화면이 "집계 데이터를 읽지 못했습니다" 에러를 보이면 먼저 이걸 의심한다.
- `npm run build` 성공은 화면이 실제로 렌더된다는 증거가 아니다. `npm run smoke`(실제 브라우저 렌더+스크린샷)로 확인한다.
- 새 패키지 의존성 추가는 `DESIGN.md`가 승인 전 금지한다(ADR 0001의 deck.gl 기각 사유 참고).

### Testing Requirements

```bash
npm install
npm run test        # Vitest 단위 테스트 (vitest run)
npm run typecheck   # tsc --noEmit
npm run build && npm run check-bundle-size   # 번들 크기 회귀 감시
npm run preview &
npm run smoke        # 실제 브라우저 렌더 + KPI 검증 + 반응형 스크린샷
npm run test:e2e     # Playwright 핵심 흐름 (pretest:e2e가 합성 픽스처를 먼저 빌드)
```

### Common Patterns

- 데이터 흐름: `public/data/*.json` → `src/data.ts`(`loadDataset`/`aggregateRegions`/`aggregateGrid`) → `src/metrics.ts`(`evaluate`/`format`) → `src/App.tsx`(렌더).
- 큐브의 필드 이름은 Python `metric_specs.COUNT_FIELDS`/`REGION_FIELDS`와 반드시 같아야 한다 — 이름이 그대로 지표 평가기의 키가 된다.
- CSS는 CSS Modules(`*.module.css`)를 컴포넌트별로 사용한다.

## Dependencies

### Internal
- `data/`, `src/`(Python), `scripts/build_web_data.py`가 이 디렉터리의 데이터 계약을 만든다.
- `docs/data-sources.md`를 `DataProvenance.tsx`가 `?raw` 임포트로 직접 읽는다.

### External
- `react`, `react-dom`, `echarts`, `maplibre-gl`, `@fontsource/*` (런타임)
- `vite`, `vitest`, `@playwright/test`, `@testing-library/*`, `typescript` (개발/테스트)
