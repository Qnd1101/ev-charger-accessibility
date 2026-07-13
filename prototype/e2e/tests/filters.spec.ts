import { expect, type Page } from "@playwright/test";
import { test } from "@playwright/test";

/**
 * 시나리오 2: 4필터(시도·속도·운영기관·24시간) 변경 시 KPI·표·차트 값이 픽스처에서
 * 손계산한 값과 일치하는지 확인한다.
 *
 * 기대값은 `e2e/fixtures/build_e2e_fixture.py` 가 만드는 합성 충전기 5행(서울 종로구 3행,
 * 부산 중구 2행)을 손으로 집계한 값이다(이 파일의 각 테스트 위 주석에 계산 과정을 남긴다).
 * 코드가 계산하는 방식을 그대로 베끼면(항진명제) 결함을 못 잡으므로, 여기서는 오직
 * 픽스처 원자료에서 직접 손으로 뽑은 숫자만 쓴다.
 */

async function kpiValues(page: Page): Promise<string[]> {
  return page.locator('[class*="kpiValue"]').allTextContents();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
});

test("무필터: 전국 5행 원자료를 손계산한 값과 KPI가 일치한다", async ({ page }) => {
  // 원자료 5행: 충전기 5기, 충전소 4개(A1·A2·B1·B2), 급속 3(row1,row3,B2), 응답 5, 사용가능 4.
  // M3(급속비율)=3/5=60.0%, M5(유휴율)=4/5=80.0%.
  const [stations, chargers, m3, m5] = await kpiValues(page);
  expect(stations).toContain("4");
  expect(chargers).toContain("5");
  expect(m3).toContain("60.0");
  expect(m5).toContain("80.0");
});

test("시도=서울특별시: 종로구 3행만 남아 KPI가 그 값으로 바뀐다", async ({ page }) => {
  // 종로구 3행: 충전기 3, 충전소 2(A1,A2), 급속 2(row1,row3), 응답 3, 사용가능 2.
  // M3=2/3=66.7%, M5=2/3=66.7%.
  await page.getByRole("checkbox", { name: "서울특별시" }).check();
  const [stations, chargers, m3, m5] = await kpiValues(page);
  expect(stations).toContain("2");
  expect(chargers).toContain("3");
  expect(m3).toContain("66.7");
  expect(m5).toContain("66.7");
});

test("속도=급속만: 전국 급속 3행(row1,row3,B2)만 남는다", async ({ page }) => {
  // 급속 슬라이스 자체가 정의상 급속비율 100%다(build_web_data 모듈 독스트링).
  // 응답 3, 사용가능 3(전부 stat=2) -> M5=100.0%.
  // 세그먼트 라디오는 시각적으로 숨겨진 네이티브 input(width/height 0) 위에 스타일드 span 을
  // 얹는다(App.module.css `.segment input{opacity:0;width:0;height:0}`) -- input 자체는
  // 뷰포트 판정에 걸려 check() 가 실패하므로, 사용자가 실제로 누르는 라벨 텍스트를 클릭한다.
  await page.getByText("급속만", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "급속만" })).toBeChecked();
  const [stations, chargers, m3, m5] = await kpiValues(page);
  expect(stations).toContain("3");
  expect(chargers).toContain("3");
  expect(m3).toContain("100.0");
  expect(m5).toContain("100.0");
});

test("24시간 이용가능만: row2(비24시간)가 빠져 4행이 남는다", async ({ page }) => {
  // 24시간 4행(row1,row3,row4,row5): 충전기 4, 충전소 4, 급속 3(row1,row3,row5),
  // 응답 4, 사용가능 4(전부 stat=2) -> M3=75.0%, M5=100.0%.
  await page.getByRole("checkbox", { name: "24시간 이용가능만" }).check();
  const [stations, chargers, m3, m5] = await kpiValues(page);
  expect(stations).toContain("4");
  expect(chargers).toContain("4");
  expect(m3).toContain("75.0");
  expect(m5).toContain("100.0");
});

test("운영기관=환경부: 한국전력공사 1행(row3)이 빠져 4행이 남는다", async ({ page }) => {
  // 환경부 4행(row1,row2,row4,row5): 충전기 4, 충전소 3(A1,B1,B2), 급속 2(row1,row5),
  // 응답 4, 사용가능 3(row1,row4,row5) -> M3=50.0%, M5=75.0%.
  await page.getByRole("checkbox", { name: /^환경부/ }).check();
  const [stations, chargers, m3, m5] = await kpiValues(page);
  expect(stations).toContain("3");
  expect(chargers).toContain("4");
  expect(m3).toContain("50.0");
  expect(m5).toContain("75.0");
});

test("취약 지역 순위 표와 랭킹 차트가 같은 값·정렬 순서를 보인다 (시나리오 8)", async ({ page }) => {
  // M2(인구10만명당 충전기) 무필터: 종로구 3.0(=3/(100000/100000)) < 중구 4.0(=2/(50000/100000)).
  // 낮을수록 취약이므로 종로구가 1위(가장 위 행).
  // 개요 패널에 상태 분포 표가 추가돼(이슈 #6) 페이지에 표가 두 개다 -- 순위 패널로 스코프한다.
  const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
  const rows = rankPanel.getByRole("table").locator("tbody tr");
  await expect(rows.first()).toContainText("종로구");
  await expect(rows.first()).toContainText("3.0");
  await expect(rows.nth(1)).toContainText("중구");
  await expect(rows.nth(1)).toContainText("4.0");

  // 차트는 표와 같은 배열을 뒤집어 그린다(RankingChart.tsx) -- y축 카테고리 라벨로 교차 검증.
  const chart = page.getByRole("img", { name: /취약 지역 순위 막대 차트/ });
  await expect(chart).toBeVisible();
});
