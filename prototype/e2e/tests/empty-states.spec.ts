import { expect, test } from "@playwright/test";

/**
 * 시나리오 3: Streamlit 3종 빈 상태 안내의 React 대응 문구.
 *
 *  (a) 충전기 0기 -- Streamlit "필터 조건에 맞는 충전기가 없습니다. 조건을 완화하세요."
 *  (b) 지도 표시 가능 좌표 0개 -- Streamlit "필터 조건에 맞는 충전기 중 지도에 표시할 수
 *      있는 좌표가 없습니다."
 *  (c) 인구 데이터 없음(접근성 탭) -- Streamlit "인구 데이터가 없어 이 지표를 계산할 수
 *      없습니다." + CSV 재생성 안내.
 *
 * (a)는 이미 App.tsx 에 구현돼 있다(문구는 다르지만 의미가 대응). (b)/(c)는 React 포팅에서
 * 빠진 기능이라 이 스위트가 처음 빨간불을 낸다 -- TDD 사이클대로 여기서 최소 구현을 붙인다.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
});

test("(a) 필터 교집합이 0기면 조건 완화 안내가 뜬다", async ({ page }) => {
  // 경기도(zcode 41)는 참조 지역표에는 있지만 합성 픽스처 충전기 데이터가 전혀 없다.
  await page.getByRole("checkbox", { name: "경기도" }).check();
  const empty = page.getByRole("status");
  await expect(empty).toContainText("충전기가 0기입니다");
  await expect(empty).toContainText("조건");
});

test("(b) 충전기는 있지만 지도에 표시 가능한 좌표가 0개면 안내가 뜬다", async ({ page }) => {
  // 부산 중구 + 급속만 -> B2(급속, 좌표 0,0 무효) 1행만 남는다. 충전기 수는 1이라 (a) 분기는
  // 타지 않지만, 좌표가 유효한 충전기가 하나도 없어 격자 셀이 0개다.
  await page.getByRole("checkbox", { name: "부산광역시" }).check();
  await page.getByText("급속만", { exact: true }).click();

  const kpis = page.getByRole("region", { name: "핵심 지표" });
  await expect(kpis).toBeVisible(); // (a) 분기가 아니라 정상 KPI 분기임을 먼저 확인

  const mapPanel = page.getByRole("region", { name: "충전기 분포" });
  await expect(mapPanel.getByText("지도에 표시할 수 있는 좌표가 없습니다")).toBeVisible();
});

test("(c) 인구 데이터가 전혀 없으면 접근성 탭에 계산 불가 안내와 재생성 방법이 뜬다", async ({ page }) => {
  // 실제로 인구 없는 두 번째 빌드를 돌리지 않고, regions.json 네트워크 응답을 가로채
  // population 을 전부 null 로 바꾼다(관찰 시드 2: 네트워크 요청 가로채기 재사용).
  await page.route("**/data/regions.json", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.regions = body.regions.map((r: Record<string, unknown>) => ({ ...r, population: null }));
    body.sidos = body.sidos.map((s: Record<string, unknown>) => ({ ...s, population: null }));
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();

  const rankPanel = page.getByRole("region", { name: "취약 지역 순위" });
  await expect(rankPanel.getByText("인구 데이터가 없어 이 지표를 계산할 수 없습니다")).toBeVisible();
  await expect(rankPanel.getByText(/python src\/metrics\.py/)).toBeVisible();
});
