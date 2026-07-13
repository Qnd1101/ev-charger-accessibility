import { expect, test } from "@playwright/test";

/**
 * 시나리오 6: 1440px/768px 에서 핵심 흐름(필터->KPI->랭킹) 확인, 360px 에서는
 * KPI 와 랭킹의 가독성(가로 스크롤 없음)만 확인한다.
 *
 * 전체 스위트를 여러 project 로 3배 돌리지 않고, 이 파일 안에서만 `test.use({ viewport })`
 * 로 필요한 뷰포트를 지정한다(playwright.config.ts 주석 참고).
 */
test.describe("1440px: 핵심 흐름 (필터 -> KPI -> 랭킹)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("시도 필터를 걸면 KPI와 랭킹이 함께 갱신된다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox", { name: "부산광역시" }).check();
    const kpis = page.getByRole("region", { name: "핵심 지표" });
    await expect(kpis).toBeVisible();
    await expect(page.locator('[class*="kpiValue"]').first()).toContainText("2");

    const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
    const rows = rankPanel.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("중구");
  });
});

test.describe("768px: 핵심 흐름 (필터 -> KPI -> 랭킹)", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("시도 필터를 걸면 KPI와 랭킹이 함께 갱신된다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("checkbox", { name: "부산광역시" }).check();
    const kpis = page.getByRole("region", { name: "핵심 지표" });
    await expect(kpis).toBeVisible();
    await expect(page.locator('[class*="kpiValue"]').first()).toContainText("2");

    const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
    const rows = rankPanel.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("중구");
  });
});

test.describe("360px: KPI·랭킹 가독성(가로 스크롤 없음)만 확인", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("KPI 섹션과 랭킹 표가 뷰포트 폭을 넘겨 가로 스크롤을 만들지 않는다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, "문서 전체가 360px 뷰포트에서 가로로 넘친다").toBeLessThanOrEqual(clientWidth + 1);

    const kpis = page.getByRole("region", { name: "핵심 지표" });
    await expect(kpis).toBeVisible();
    const kpiBox = await kpis.boundingBox();
    expect(kpiBox?.width, "KPI 섹션이 뷰포트 폭을 넘긴다").toBeLessThanOrEqual(360 + 1);

    const table = page.getByRole("table");
    await expect(table).toBeVisible();
  });
});
