import { expect, test } from "@playwright/test";

/**
 * 시각 회귀: 승인된 Split Command 데스크톱(1440px)·태블릿(768px) 기준 화면.
 *
 * 360px는 대상에서 뺀다 -- 스펙이 요구하는 범위는 "1440px/768px에서 핵심 흐름,
 * 360px에서는 KPI·랭킹의 가독성(가로 스크롤 없음)"뿐이고, 360px 픽셀 비교는
 * responsive.spec.ts 시나리오 6이 이미 구조적으로(스크롤 폭) 검증한다.
 *
 * 배경지도(MapLibre)는 `mask` 로 스크린샷 비교에서 제외한다. 타일 로딩 타이밍과
 * 안티앨리어싱이 프레임마다 미세하게 달라져 지도 영역만으로 문케(flaky)가 나기
 * 쉽고, 지도가 보여주는 값 자체는 map.spec.ts/sections.spec.ts가 접근성 트리로
 * 이미 검증한다 -- 시각 회귀는 그 옆 레이아웃(필터 레일, KPI, 랭킹 패널)의
 * 의도치 않은 리그레션만 잡으면 된다. `.maplibregl-map` 은 MapLibre가 우리
 * CSS 모듈과 무관하게 항상 붙이는 컨테이너 클래스라 안정적인 마스크 대상이다.
 *
 * maxDiffPixelRatio: 0.02(2%) -- 폰트 서브픽셀 렌더링, 지도 마스크 경계의
 * 안티앨리어싱 잔여 픽셀 등 실제 리그레션이 아닌 미세 차이를 흡수하되, 필터
 * 레일 배경색처럼 눈에 띄는 레이아웃 변화는 여전히 잡아낼 만큼 낮게 잡았다
 * (결함 주입 검증으로 확인).
 */
const VISUAL_DIFF_OPTIONS = {
  maxDiffPixelRatio: 0.02,
  animations: "disabled" as const,
};

async function gotoAndSettle(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
  // 지도 레이어 설치(비동기 fetch + maplibre load 이벤트)가 끝날 시간을 준다
  // (accessibility.spec.ts 와 동일한 대기 패턴).
  await page.waitForTimeout(500);
}

test.describe("1440px: 데스크톱 기준 화면", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("필터 없음 기본 화면이 기준 스크린샷과 일치한다(지도 영역 마스킹)", async ({ page }) => {
    await gotoAndSettle(page);
    const mapArea = page.locator(".maplibregl-map");
    await expect(page).toHaveScreenshot("desktop-1440-default.png", {
      fullPage: true,
      mask: [mapArea],
      ...VISUAL_DIFF_OPTIONS,
    });
  });

  test("필터 적용 화면이 기준 스크린샷과 일치한다(지도 영역 마스킹)", async ({ page }) => {
    await gotoAndSettle(page);
    await page.getByRole("checkbox", { name: "부산광역시" }).check();
    await expect(page.locator('[class*="kpiValue"]').first()).toContainText("2");
    const mapArea = page.locator(".maplibregl-map");
    await expect(page).toHaveScreenshot("desktop-1440-filtered.png", {
      fullPage: true,
      mask: [mapArea],
      ...VISUAL_DIFF_OPTIONS,
    });
  });
});

test.describe("768px: 태블릿 기준 화면", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("필터 없음 기본 화면이 기준 스크린샷과 일치한다(지도 영역 마스킹)", async ({ page }) => {
    await gotoAndSettle(page);
    const mapArea = page.locator(".maplibregl-map");
    await expect(page).toHaveScreenshot("tablet-768-default.png", {
      fullPage: true,
      mask: [mapArea],
      ...VISUAL_DIFF_OPTIONS,
    });
  });
});
