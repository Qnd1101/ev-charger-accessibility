import { expect, test } from "@playwright/test";
import { KNOWN_DATA_FILES } from "./known-data-files";

/**
 * 관찰 시드 2: 네트워크 요청 가로채기.
 *
 *  (a) 배경지도 타일 요청만 허용되고 충전 데이터 API 호출은 없다.
 *  (b) 51만 원본 좌표 배열이 전송되지 않는다 -- 정적 집계 계약(meta/metrics/operators/
 *      regions/region_cube/grid_cube/sigungu.topo)만 있어야 하고, 그 밖의 원본류 엔드포인트
 *      (chargers*.json, *_clean* 등)가 새로 생기면 여기서 잡는다.
 */

test("페이지 로드 + 필터 조작 동안 외부 요청은 배경지도 타일뿐이고, 충전 데이터는 알려진 정적 집계 파일에서만 온다", async ({ page }) => {
  const externalHosts = new Set<string>();
  const dataRequests: string[] = [];

  page.on("request", (req) => {
    const url = new URL(req.url());
    // blob:/data: 등은 실제 네트워크 egress 가 아니다(maplibre 워커가 스타일을 blob 으로
    // 감싸는 경우가 있다) -- 실제 호스트로 나가는 http(s) 요청만 본다.
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.hostname !== "127.0.0.1") {
      externalHosts.add(url.hostname);
      return;
    }
    if (url.pathname.includes("/data/")) {
      dataRequests.push(url.pathname.split("/").pop()!);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();

  // 필터를 조작해도 새로운 데이터 API 호출이 생기지 않는다 -- 화면은 이미 받은 큐브를
  // 메모리에서만 재집계한다(App.tsx aggregateRegions/aggregateGrid).
  await page.getByRole("checkbox", { name: "서울특별시" }).check();
  await page.getByText("급속만", { exact: true }).click();
  await page.getByRole("checkbox", { name: "24시간 이용가능만" }).check();
  await page.waitForTimeout(300);

  for (const host of externalHosts) {
    expect(host, `허용되지 않은 외부 호스트: ${host}`).toMatch(/(^|\.)basemaps\.cartocdn\.com$/);
  }

  for (const file of dataRequests) {
    expect(KNOWN_DATA_FILES.has(file), `알 수 없는 데이터 엔드포인트: ${file}`).toBe(true);
  }
  // 정적 집계 계약 파일만 오갔고, 원본류(chargers*, *_clean*) 엔드포인트는 없어야 한다.
  expect(dataRequests.some((f) => /chargers|clean|raw/i.test(f))).toBe(false);
});

test("필터를 바꿔도 지역/격자 큐브 응답 행 수는 픽스처 규모(수십 행)를 벗어나지 않는다", async ({ page }) => {
  // 51만 원본이 새면 이 큐브들이 아니라 새 엔드포인트로 온다(위 테스트가 잡는다).
  // 여기서는 그 반대 방향 -- 기존 큐브 자체가 원본 규모로 부풀지 않았는지 크기로 확인한다.
  const [regionRes, gridRes] = await Promise.all([
    page.request.get("/data/region_cube.json"),
    page.request.get("/data/grid_cube.json"),
  ]);
  const region = await regionRes.json();
  const grid = await gridRes.json();
  expect(Array.isArray(region)).toBe(true);
  expect(Array.isArray(grid)).toBe(true);
  expect(region.length).toBeLessThan(1000);
  expect(grid.length).toBeLessThan(1000);
});
