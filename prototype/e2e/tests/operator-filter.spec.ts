import { expect, test } from "@playwright/test";

/**
 * 시나리오 4: 운영기관 필터를 켜면
 *   - 취약 지역 순위 제목이 "충전 인프라 부족 지역" -> "선택 운영기관 공급 현황"으로 바뀐다
 *     (App.tsx:564 근방 opFiltered 분기).
 *   - 해당 운영기관이 미진출인 지역은 값 대신 "미진출" 라벨이 뜬다(App.tsx:592,602 근방).
 *   - 미진출 지역이 결과 목록에서 사라지지 않는다.
 *
 * 픽스처: 한국전력공사는 서울 종로구에만 있고 부산 중구에는 없다
 * (e2e/fixtures/build_e2e_fixture.py 의 row3만 한국전력공사).
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
});

test("운영기관 미선택: 제목은 '충전 인프라 부족 지역'이다", async ({ page }) => {
  const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
  await expect(rankPanel.getByRole("heading", { name: "충전 인프라 부족 지역" })).toBeVisible();
});

test("한국전력공사만 선택: 제목이 바뀌고 미진출 지역(중구)이 값 대신 라벨로, 목록에서 사라지지 않고 남는다", async ({ page }) => {
  await page.getByRole("checkbox", { name: /^한국전력공사/ }).check();

  const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
  await expect(rankPanel.getByRole("heading", { name: "선택 운영기관 공급 현황" })).toBeVisible();
  await expect(rankPanel.getByRole("heading", { name: "충전 인프라 부족 지역" })).toHaveCount(0);

  const rows = rankPanel.getByRole("table").locator("tbody tr");
  const jongno = rows.filter({ hasText: "종로구" });
  const junggu = rows.filter({ hasText: "중구" });

  // 미진출 지역도 결과 목록에서 사라지지 않아야 한다.
  await expect(jongno).toHaveCount(1);
  await expect(junggu).toHaveCount(1);

  // 중구엔 한국전력공사가 없다 -> 값 대신 "미진출".
  await expect(junggu).toContainText("미진출");
  // 종로구엔 한국전력공사 1기 -> M2 = 1 / (100,000/100,000) = 1.0, "미진출"이 아니다.
  await expect(jongno).not.toContainText("미진출");
  await expect(jongno).toContainText("1.0");

  await expect(rankPanel.getByText("‘미진출’은 선택한 운영기관의 충전기가 0기라는 뜻입니다.")).toBeVisible();
});
