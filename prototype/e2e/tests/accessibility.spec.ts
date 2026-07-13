import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

/** 시나리오 7: axe-core 로 페이지별 심각(critical/serious) 위반 0. */
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

async function seriousViolations(page: import("@playwright/test").Page) {
  await page.addScriptTag({ path: axePath });
  const results = await page.evaluate(async () => {
    // @ts-expect-error axe 는 addScriptTag 로 전역에 주입된다.
    return window.axe.run(document, {
      resultTypes: ["violations"],
    });
  });
  return (results.violations as { impact: string; id: string; nodes: unknown[] }[]).filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
  // 지도 레이어 설치(비동기 fetch + maplibre load 이벤트)가 끝날 시간을 준다.
  await page.waitForTimeout(500);
});

test("기본 화면(필터 없음): critical/serious 위반 0", async ({ page }) => {
  const violations = await seriousViolations(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

test("필터 적용 화면(시도+속도+운영기관): critical/serious 위반 0", async ({ page }) => {
  await page.getByRole("checkbox", { name: "서울특별시" }).check();
  await page.getByText("급속만", { exact: true }).click();
  await page.getByRole("checkbox", { name: /^환경부/ }).check();
  const violations = await seriousViolations(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

test("빈 결과 화면(충전기 0기 안내): critical/serious 위반 0", async ({ page }) => {
  await page.getByRole("checkbox", { name: "경기도" }).check();
  await expect(page.getByRole("status")).toContainText("충전기가 0기입니다");
  const violations = await seriousViolations(page);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});
