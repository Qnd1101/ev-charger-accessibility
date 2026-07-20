<!-- Parent: ../../AGENTS.md -->

# prototype/e2e/tests

## Purpose

Playwright 스펙 파일. 실제 브라우저에서 필터·지도·접근성·성능 예산·반응형·시각적 회귀를 검증한다. `prototype/e2e/fixtures/build_e2e_fixture.py`가 만든 결정적 합성 데이터(`e2e/.output/`)에 대해 실행된다.

## Key Files

| File | Description |
|------|--------------|
| `known-data-files.ts` | `network.spec.ts`와 `performance.spec.ts`가 공유하는 화이트리스트(`KNOWN_DATA_FILES`) — `prototype/public/data/`의 정적 집계 파일 7종. 원본류 대용량 파일(`chargers*.json` 등)이 새로 노출되면 두 스펙 모두 이 목록 기준으로 잡아낸다 |
| `network.spec.ts` | 브라우저가 화이트리스트 밖 데이터(원본 51만 건 배열 등)를 요청하지 않는지 검증 |
| `performance.spec.ts` | 정적 데이터 전송량 5MB 예산, 첫 화면 로드 5초 예산(Navigation Timing) 검증. `known-data-files.ts`를 재사용 |
| `accessibility.spec.ts` | axe-core로 기본/필터 적용/빈 결과 화면 각각 critical·serious 위반 0건 검증 |
| `filters.spec.ts` | 시도·속도·운영기관·24시간 필터 조합 동작 검증 |
| `operator-filter.spec.ts` | 운영기관 필터와 "미진출" 상태 표시 검증 |
| `empty-states.spec.ts` | 필터 결과 0건일 때 안내 문구·복구 가능 조건 표시 검증 |
| `map.spec.ts` | 지도 렌더링 기본 동작 검증 |
| `ranking-toggle.spec.ts` | M1/M2 랭킹 지표 토글 동작 검증 |
| `sections.spec.ts` | 화면 섹션 구성(KPI·지도·랭킹) 검증 |
| `responsive.spec.ts` | 1440/768/360px 반응형 레이아웃(가로 스크롤 없음 등) 검증 |
| `visual-regression.spec.ts` | 스크린샷 기반 시각적 회귀 검증. 스냅샷은 `visual-regression.spec.ts-snapshots/`에 저장 |

## For AI Agents

### Working In This Directory

- `prototype/public/data/`에 새 산출물 파일을 추가하면 `known-data-files.ts`의 `KNOWN_DATA_FILES`도 함께 갱신한다 — 안 하면 `network.spec.ts`/`performance.spec.ts`가 새 파일을 "알 수 없는 데이터 엔드포인트"로 오탐한다.
- 이 테스트들은 `npm run pretest:e2e`가 만든 합성 데이터에 대해 돈다. 실행 전 `data/ref/`의 실제 참조 자산(zscode_map.csv 등)은 그대로 쓰이므로, 참조 자산을 바꾸면 여기 기대값도 영향받을 수 있다.
- 시각적 회귀 스냅샷을 의도적으로 갱신할 때만 `npm run test:e2e:update-snapshots`를 쓴다. 실패를 이 명령으로 덮어써서 "고치는" 방식은 회귀를 숨긴다.

### Testing Requirements

```bash
cd prototype
npm run test:e2e                       # pretest:e2e 훅이 합성 픽스처+빌드를 먼저 실행
npm run test:e2e:update-snapshots       # 시각적 스냅샷 의도적 갱신
```

## Dependencies

### Internal
- `prototype/e2e/fixtures/build_e2e_fixture.py`(데이터 생성), `prototype/e2e/vite.e2e.config.ts`(빌드 설정)

### External
- `@playwright/test`, `axe-core`
