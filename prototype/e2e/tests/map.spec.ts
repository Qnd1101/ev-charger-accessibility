import { expect, test } from "@playwright/test";

/**
 * 시나리오 5: 지도에서 무효 좌표로 제외된 충전기 수가 지도 옆에 표시된다.
 *
 * 픽스처: 부산 중구 B2 1기가 좌표 (0,0) 무효(meta.invalid_coord_chargers=1).
 * 이 값은 필터와 무관하게 전국 고정값이다(App.tsx 는 `meta.invalid_coord_chargers`를
 * 그대로 보여준다 -- 필터별로 다시 세지 않는다).
 */
test("지도 패널이 전국 무효 좌표 충전기 수(1기)를 캡션에 밝힌다", async ({ page }) => {
  await page.goto("/");
  const mapPanel = page.getByRole("region", { name: "충전기 분포" });
  await expect(mapPanel).toContainText("좌표가 무효한 충전기");
  await expect(mapPanel).toContainText("1기");
  await expect(mapPanel).toContainText("지도에서만 빠지고");
});
