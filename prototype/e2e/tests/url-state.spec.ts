import { expect, test } from "@playwright/test";

/**
 * 합성 스냅샷에서 한국전력공사는 서울 종로구의 24시간 급속 충전기 1기만 운영한다.
 * 공유 URL로 이 기관을 선택한 뒤 상태 변경·새로고침까지 같은 분석 범위를 보존하는지 본다.
 */
test("공유 URL의 필터를 적용하고 변경한 상태를 새로고침 뒤에도 보존한다", async ({ page }) => {
  const query = new URLSearchParams({
    z: "11",
    op: JSON.stringify(["한국전력공사"]),
    speed: "fast",
    view: "heat",
    metric: "M1",
  });
  await page.goto(`/?${query.toString()}#rail`);

  const operator = page.getByRole("checkbox", { name: /^한국전력공사/ });
  await expect(page.getByRole("checkbox", { name: "서울특별시" })).toBeChecked();
  await expect(operator).toBeChecked();
  await expect(page.getByRole("radio", { name: "급속만" })).toBeChecked();
  await expect(page.locator('[class*="railResultValue"]')).toHaveText("1");
  await expect(page.getByRole("button", { name: "히트맵" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /전기차 기준/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("checkbox", { name: "24시간 이용가능만" }).check();
  await expect.poll(() => new URL(page.url()).searchParams.get("h24")).toBe("1");
  expect(new URL(page.url()).hash).toBe("#rail");
  expect(JSON.parse(new URL(page.url()).searchParams.get("op")!)).toEqual(["한국전력공사"]);

  await page.reload();

  await expect(operator).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "서울특별시" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "급속만" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "24시간 이용가능만" })).toBeChecked();
  await expect(page.getByRole("button", { name: "히트맵" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /전기차 기준/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[class*="railResultValue"]')).toHaveText("1");
});
