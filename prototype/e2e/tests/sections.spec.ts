import { expect, test } from "@playwright/test";

/**
 * 시나리오 1: Streamlit 4탭(개요/분포 지도/부족 지역 랭킹/접근성 랭킹) 동등성.
 *
 * React 화면은 탭이 아니라 한 화면(Split Command)에 네 섹션을 모두 올린다
 * (App.tsx 파일 docstring). 그래서 "탭 전환"이 아니라 "네 섹션이 모두 접근성 트리에서
 * 올바른 role/이름으로 로드되는가"를 확인한다 -- 관찰 시드 1(접근성 트리)만 본다.
 */
test.describe("네 섹션(개요·분포 지도·부족 지역 랭킹·접근성 랭킹) 동등 로드", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
  });

  test("개요: 핵심 지표(KPI) 섹션이 충전소·충전기·급속비율·유휴율을 보여준다", async ({ page }) => {
    const kpis = page.getByRole("region", { name: "핵심 지표" });
    await expect(kpis).toBeVisible();
    await expect(kpis.getByText("충전소")).toBeVisible();
    await expect(kpis.getByText("충전기", { exact: true })).toBeVisible();
  });

  test("분포 지도: 지도 패널이 지역 지도로 로드된다", async ({ page }) => {
    const mapPanel = page.getByRole("region", { name: "충전기 분포" });
    await expect(mapPanel).toBeVisible();
    await expect(mapPanel.getByRole("region", { name: /충전 인프라 지역 지도/ })).toBeVisible();
  });

  test("부족 지역 랭킹: 취약 지역 순위 섹션이 막대 차트와 표를 함께 보여준다", async ({ page }) => {
    const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
    await expect(rankPanel).toBeVisible();
    await expect(rankPanel.getByRole("heading", { name: "충전 인프라 부족 지역" })).toBeVisible();
    await expect(rankPanel.getByRole("img", { name: /취약 지역 순위 막대 차트/ })).toBeVisible();
    await expect(rankPanel.getByRole("table")).toBeVisible();
  });

  test("접근성 랭킹: 순위 표 배지가 인구 해상도와 지표 ID(M2)를 밝힌다", async ({ page }) => {
    const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
    await expect(rankPanel.getByText("시군구 기준 · 인구 10만 명당")).toBeVisible();
  });
});
