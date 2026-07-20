<!-- Parent: ../AGENTS.md -->

# prototype/e2e

## Purpose

Playwright E2E 스위트 설정. 실제 브라우저에서 필터·지도·접근성·성능·반응형·시각적 회귀를 검증한다. 단위 테스트(`prototype/src/*.test.tsx`, jsdom)와 달리 실제 렌더링·네트워크·레이아웃을 확인한다.

## Key Files

| File | Description |
|------|--------------|
| `vite.e2e.config.ts` | E2E 전용 Vite 빌드 설정. `npm run pretest:e2e`가 이 설정으로 빌드한다 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `fixtures/` | 합성 데이터로 실제 파이프라인을 돌려 E2E용 데이터를 만드는 생성기 (see `fixtures/AGENTS.md`) |
| `tests/` | Playwright 스펙 파일들 (see `tests/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- E2E는 `prototype/e2e/.output/`(`.gitignore` 대상, `fixtures/build_e2e_fixture.py`로 재생성)에서 데이터를 읽는다. `prototype/public/data/`(개발용 실 데이터)와는 별개의 합성 데이터셋이다.
- 실행 순서: `npm run pretest:e2e`(합성 픽스처 빌드 + E2E용 Vite 빌드) → `npm run test:e2e`(Playwright 실행). `package.json`이 이 순서를 스크립트로 강제한다.
- 스냅샷을 갱신할 때는 `npm run test:e2e:update-snapshots`를 쓴다(내부적으로 `pretest:e2e`도 재실행됨).

### Testing Requirements

```bash
cd prototype
npm run test:e2e
```

## Dependencies

### Internal
- `prototype/e2e/fixtures/build_e2e_fixture.py`가 `src/`(Python), `scripts/`를 재사용한다.
- `playwright.config.ts`(prototype 루트)가 이 디렉터리의 설정을 참조한다.

### External
- `@playwright/test`, `playwright`
