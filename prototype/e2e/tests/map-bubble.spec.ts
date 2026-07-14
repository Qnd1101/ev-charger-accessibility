import { expect, test } from "@playwright/test";

/**
 * 밀집 원(과밀 탐색) 뷰: 지도 표시 방식 토글에 4번째 모드 "밀집 원"이 있고, 누르면
 * 배지가 "2km 밀집 원"으로 바뀐다. 원 크기로 2km 셀별 충전기 수(=물리적 밀집)를 본다.
 *
 * 지도 캔버스 자체(maplibre WebGL)는 이 환경에서 배경지도 타일 통신에 의존해 렌더가
 * 불안정하므로, 여기서는 렌더 픽셀이 아니라 "뷰 전환 계약"(토글 존재·배지 문구·aria-pressed)
 * 만 확인한다. 레이어 가시성 전환은 DistributionMap.test.tsx(단위)가 검증한다.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
});

test("지도 표시 방식에 '밀집 원' 토글이 있고, 누르면 배지가 '2km 밀집 원'으로 바뀐다", async ({
  page,
}) => {
  const mapPanel = page.getByRole("region", { name: "충전기 분포" });
  const toggle = mapPanel.getByRole("group", { name: "지도 표시 방식" });

  const bubbleBtn = toggle.getByRole("button", { name: "밀집 원" });
  await expect(bubbleBtn).toBeVisible();
  await expect(bubbleBtn).toHaveAttribute("aria-pressed", "false");
  // 기본은 코로플레스(취약도) 뷰다.
  await expect(mapPanel.getByText("시군구 코로플레스")).toBeVisible();

  await bubbleBtn.click();

  await expect(bubbleBtn).toHaveAttribute("aria-pressed", "true");
  await expect(mapPanel.getByText("2km 밀집 원")).toBeVisible();
});

test("밀집 원 뷰는 필터 변경 후에도 유지된다(뷰 상태와 필터 상태가 독립적이다)", async ({ page }) => {
  const mapPanel = page.getByRole("region", { name: "충전기 분포" });
  await mapPanel.getByRole("button", { name: "밀집 원" }).click();
  await expect(mapPanel.getByText("2km 밀집 원")).toBeVisible();

  await page.getByRole("checkbox", { name: "서울특별시" }).check();

  await expect(mapPanel.getByRole("button", { name: "밀집 원" })).toHaveAttribute("aria-pressed", "true");
  await expect(mapPanel.getByText("2km 밀집 원")).toBeVisible();
});
