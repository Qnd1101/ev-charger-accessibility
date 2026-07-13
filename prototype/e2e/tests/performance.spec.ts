import { expect, test } from "@playwright/test";
import { KNOWN_DATA_FILES } from "./known-data-files";

/**
 * 관찰 시드 2(네트워크 요청 가로채기)의 연장: 성능 예산.
 *
 * network.spec.ts 가 "원본 충전기 배열이 새지 않는가"(계약 위반)를 잡는다면, 여기서는
 * "그 계약을 지키는 정적 집계가 실제로 가벼운가"(예산 위반)를 잡는다. 이슈 #1 "테스트
 * 결정" 절이 요구하는 세 가지를 한 파일에 모은다:
 *   (a) 원본 충전기 배열 부재 -- network.spec.ts 와 같은 KNOWN_DATA_FILES 화이트리스트를
 *       공유해 같은 계약으로 판정한다(중복 구현 금지).
 *   (b) 정적 데이터 전송량 -- /data/ 아래로 내려받는 바이트 총합.
 *   (c) 첫 전국 화면 5초 예산 -- page.goto 의 load 이벤트까지 걸린 시간.
 */

// 51만 원본 좌표(수십 MB급 GeoJSON/parquet)는 포함하지 않으므로 실제 픽스처 규모
// (수백 KB, sigungu.topo.json 이 대부분)보다 훨씬 널널하게 잡는다. 이 상한을 넘기면
// 정적 집계 계약이 깨져 원본급 데이터가 다시 새고 있다는 뜻이다.
const STATIC_DATA_BYTE_BUDGET = 5 * 1024 * 1024; // 5MB
const FIRST_LOAD_MS_BUDGET = 5000; // 5초

test("첫 전국 화면 로드: 정적 데이터 전송량은 5MB 이하이고, 원본 충전기 배열은 포함되지 않는다", async ({
  page,
}) => {
  const dataFiles: string[] = [];
  // vite preview 는 compression 미들웨어로 JSON 을 gzip 응답한다 -- content-length 헤더가
  // 빠지므로(chunked) 헤더 합산은 틀린다. res.body() 로 실제 페이로드 바이트를 잰다
  // (전송 압축분이 아니라 순수 데이터 볼륨 -- "정적 데이터 전송량" 예산의 취지에 맞다).
  const bodyByteSizes: Promise<number>[] = [];

  page.on("response", (res) => {
    const url = new URL(res.url());
    if (url.hostname !== "127.0.0.1" || !url.pathname.includes("/data/")) return;
    dataFiles.push(url.pathname.split("/").pop()!);
    bodyByteSizes.push(res.body().then((b) => b.length));
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();
  // sigungu.topo.json 등 지도 컴포넌트 마운트 후 뒤늦게 나가는 요청이 있어 heading 가시성
  // 만으로는 아직 안 끝났을 수 있다 -- 첫 화면이 실제로 안정될 때까지 기다린다.
  await page.waitForLoadState("networkidle");

  // (a) 원본 충전기 배열 부재 -- network.spec.ts 와 동일 계약으로 재확인한다.
  for (const file of dataFiles) {
    expect(KNOWN_DATA_FILES.has(file), `알 수 없는 데이터 엔드포인트: ${file}`).toBe(true);
  }
  expect(dataFiles.some((f) => /chargers|clean|raw/i.test(f))).toBe(false);

  // (b) 정적 데이터 전송량 예산.
  expect(dataFiles.length).toBeGreaterThan(0);
  const dataBytesTotal = (await Promise.all(bodyByteSizes)).reduce((a, b) => a + b, 0);
  expect(
    dataBytesTotal,
    `정적 데이터 전송량 ${dataBytesTotal}B 가 예산 ${STATIC_DATA_BYTE_BUDGET}B 를 초과했다`,
  ).toBeLessThanOrEqual(STATIC_DATA_BYTE_BUDGET);
});

test("첫 전국 화면 로드는 5초 예산 이내에 끝난다 (Navigation Timing)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeVisible();

  const loadMs = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return nav.loadEventEnd - nav.startTime;
  });

  expect(loadMs, `첫 로드 ${loadMs}ms 가 예산 ${FIRST_LOAD_MS_BUDGET}ms 를 초과했다`).toBeLessThan(
    FIRST_LOAD_MS_BUDGET,
  );
});
