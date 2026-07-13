import { defineConfig, devices } from "@playwright/test";

/**
 * Streamlit -> React 기능 동등성 E2E 스위트.
 *
 * 이 스위트는 `npm run build` 프로덕션 빌드를 로컬 정적 서버로 서빙해 구동한다(`webServer`).
 * 데이터는 `e2e/fixtures/build_e2e_fixture.py` 가 만든 합성 집계(prototype/e2e/.output/data)
 * 를 프로덕션 빌드 안에 복사해 쓴다 -- `npm run test:e2e`가 이 순서를 보장한다.
 *
 * 브라우저는 이 환경에 설치된 Chromium 만 쓴다. 반응형 시나리오(1440/768/360)는 여러
 * project 로 전체 스위트를 3배 돌리지 않는다 -- `e2e/tests/responsive.spec.ts` 안에서
 * `test.use({ viewport })` 로 필요한 뷰포트만 골라 쓴다(요구사항은 여러 브라우저 엔진이
 * 아니라 여러 뷰포트다).
 */
export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173/",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    // 빌드는 npm run test:e2e (pretest:e2e 훅)가 먼저 끝내둔다. 여기서는 그 정적
    // 산출물을 서빙만 한다 -- 매 테스트 실행마다 다시 빌드하면 느리고, 빌드 실패를
    // webServer 타임아웃으로 오진하게 된다.
    command: "npx vite preview -c e2e/vite.e2e.config.ts --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
