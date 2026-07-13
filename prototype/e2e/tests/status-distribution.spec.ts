import { expect, test } from "@playwright/test";

/**
 * 이슈 #6: 개요 패널에 충전기 상태 분포 표 추가.
 *
 * 기대값은 `e2e/fixtures/build_e2e_fixture.py` 가 만드는 합성 충전기 5행을 손으로 집계한
 * 값이다(filters.spec.ts 와 같은 원자료). 5행 모두 stat 은 2(충전대기) 또는 3(충전중)뿐이다:
 *   - A1-01(종로구,환경부,급속): stat=2
 *   - A1-02(종로구,환경부,완속): stat=3
 *   - A2-01(종로구,한국전력공사,급속): stat=2
 *   - B1-01(중구,환경부,완속): stat=2
 *   - B2-01(중구,환경부,급속,좌표무효): stat=2
 * 전국 합계: 충전대기 4, 충전중 1 (다른 상태 코드는 0기라 표에 나타나지 않는다).
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
});

test("무필터: 전국 5행을 손계산한 상태 분포(충전대기 4, 충전중 1)와 표가 일치하고, 합계가 '충전기' KPI와 같다", async ({
  page,
}) => {
  const panel = page.getByRole("region", { name: "충전기 상태 분포" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("row", { name: "충전대기 4" })).toBeVisible();
  await expect(panel.getByRole("row", { name: "충전중 1" })).toBeVisible();

  // 표에 나타나지 않는 상태(운영중지 등)는 0기이므로 행이 없어야 한다 -- 원본 Streamlit
  // 구현(value_counts)과 같은 동작이다.
  await expect(panel.getByRole("row")).toHaveCount(3); // 헤더 1행 + 데이터 2행

  // 필터 후 충전기 KPI(App.tsx `.kpiValue`, filters.spec.ts 의 kpiValues() 와 같은 셀렉터).
  const [, chargerValue] = await page.locator('[class*="kpiValue"]').allTextContents();
  expect(chargerValue).toContain("5");
});

test("시도=서울특별시: 종로구 3행만 남아 상태 분포가 충전대기 2·충전중 1로 바뀐다", async ({ page }) => {
  await page.getByRole("checkbox", { name: "서울특별시" }).check();

  const panel = page.getByRole("region", { name: "충전기 상태 분포" });
  await expect(panel.getByRole("row", { name: "충전대기 2" })).toBeVisible();
  await expect(panel.getByRole("row", { name: "충전중 1" })).toBeVisible();
});

test("한국전력공사만 선택: 종로구 1행만 남아 상태 분포가 충전대기 1뿐이다", async ({ page }) => {
  await page.getByRole("checkbox", { name: /^한국전력공사/ }).check();

  const panel = page.getByRole("region", { name: "충전기 상태 분포" });
  await expect(panel.getByRole("row", { name: "충전대기 1" })).toBeVisible();
  await expect(panel.getByRole("row", { name: "충전중" })).toHaveCount(0);
});
