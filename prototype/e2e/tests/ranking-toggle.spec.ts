import { expect, test } from "@playwright/test";

/**
 * 시나리오 9: 취약 지역 순위 패널의 M1/M2 토글.
 *
 * Streamlit 은 M1(시도별 EV1000대당)과 M2(시군구별 인구10만당)를 별도 화면(탭)으로
 * 나누지만, React 는 한 화면(Split Command)의 기존 랭킹 패널에 토글로 얹는다
 * (issue #1 "네 화면·네 필터 기능 동등성"). 기본값은 M2 — 토글이 생기기 전 동작과
 * 하위 호환이어야 한다.
 *
 * M1 기대값은 `build_e2e_fixture.py` 원자료를 손으로 뽑는다(항진명제 회피):
 * - 서울특별시: 종로구 3행 전부 시도 합산 -> 충전기 3기. EV 등록 3,000대(SEOUL_EV).
 *   M1 = 3 / (3000/1000) = 1.0 기/EV1000대.
 * - 부산광역시: 중구 2행 전부 시도 합산 -> 충전기 2기. EV 등록 1,000대(BUSAN_EV).
 *   M1 = 2 / (1000/1000) = 2.0 기/EV1000대.
 * 나머지 15개 시도는 충전기 0기라 M1=0.0으로 상위 12곳을 다 채우므로, 서울·부산만
 * 남기려면 시도 필터로 범위를 좁힌다(전체 순위 중 두 지역 위치를 매번 계산하지 않기 위해).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
});

test("기본값은 M2다 (하위 호환): 순위 패널 배지가 시군구 기준 · 인구 10만 명당을 보여준다", async ({ page }) => {
  const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
  await expect(rankPanel.getByText("시군구 기준 · 인구 10만 명당")).toBeVisible();
  await expect(rankPanel.getByRole("button", { name: /인구 기준/ })).toHaveAttribute("aria-pressed", "true");
  await expect(rankPanel.getByRole("button", { name: /전기차 기준/ })).toHaveAttribute("aria-pressed", "false");
});

test("M1 토글: 서울특별시·부산광역시로 범위를 좁히면 시도 단위 손계산 값과 일치한다", async ({ page }) => {
  await page.getByRole("checkbox", { name: "서울특별시" }).check();
  await page.getByRole("checkbox", { name: "부산광역시" }).check();

  const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
  await rankPanel.getByRole("button", { name: /전기차 기준/ }).click();
  await expect(rankPanel.getByRole("button", { name: /전기차 기준/ })).toHaveAttribute("aria-pressed", "true");

  // 배지·표 헤더가 시도 해상도·전기차 기준 지표로 바뀐다.
  await expect(rankPanel.getByText("시도 기준 · 전기차 1,000대당")).toBeVisible();
  await expect(rankPanel.getByRole("columnheader", { name: /전기차 1,000대당/ })).toBeVisible();

  const rows = rankPanel.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  // 낮을수록 취약이므로 서울(1.0)이 부산(2.0)보다 위(1위)에 온다.
  await expect(rows.first()).toContainText("서울특별시");
  await expect(rows.first()).toContainText("1.0");
  await expect(rows.nth(1)).toContainText("부산광역시");
  await expect(rows.nth(1)).toContainText("2.0");

  // 차트도 같은 배열을 그린다 -- 표와 교차 검증할 수 있게 계속 보여야 한다.
  await expect(rankPanel.getByRole("img", { name: /취약 지역 순위 막대 차트/ })).toBeVisible();
});

test("M1에서 M2로 되돌리면 배지·표가 원래 시군구 값으로 복원된다 (회귀 없음)", async ({ page }) => {
  const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
  await rankPanel.getByRole("button", { name: /전기차 기준/ }).click();
  await expect(rankPanel.getByText("시도 기준 · 전기차 1,000대당")).toBeVisible();

  await rankPanel.getByRole("button", { name: /인구 기준/ }).click();
  await expect(rankPanel.getByRole("button", { name: /인구 기준/ })).toHaveAttribute("aria-pressed", "true");
  await expect(rankPanel.getByText("시군구 기준 · 인구 10만 명당")).toBeVisible();

  // 기존 필터 시나리오 8(무필터 M2 표)과 같은 값으로 되돌아온다.
  const rows = rankPanel.getByRole("table").locator("tbody tr");
  await expect(rows.first()).toContainText("종로구");
  await expect(rows.first()).toContainText("3.0");
  await expect(rows.nth(1)).toContainText("중구");
  await expect(rows.nth(1)).toContainText("4.0");
});
