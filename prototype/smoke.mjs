/**
 * 프로토타입 스모크 + 승인용 스크린샷.
 *
 * 빌드 성공은 화면이 실제로 렌더된다는 증거가 되지 못한다(Streamlit 스모크와 같은 이유).
 * 실제 브라우저로 띄워 KPI 가 Python 파이프라인과 같은 값을 내는지 확인하고,
 * DESIGN.md 승인 기준인 1440px / 768px / 360px 화면을 남긴다.
 *
 * usage: node smoke.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:4173";
const meta = JSON.parse(readFileSync("public/data/meta.json", "utf8"));
const expected = meta.total_chargers.toLocaleString("ko-KR");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

// CI/샌드박스에서도 외부 통신 실패 경로를 결정적으로 검증한다. JSON 파싱 실패는 앱이
// 잡아 로컬 격자로 강등하므로 브라우저 자체의 네트워크 오류를 콘솔 실패로 오인하지 않는다.
await page.route("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: "{" }));

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const t0 = Date.now();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByLabel("핵심 지표").waitFor({ timeout: 15_000 });
const ready = Date.now() - t0;

const chargers = await page.locator("aside div").filter({ hasText: /^[\d,]+$/ }).first().innerText();
if (chargers !== expected) {
  throw new Error(`필터 후 충전기 ${chargers} != 파이프라인 ${expected}`);
}

// 운영기관을 고르면 화면이 '선택 운영기관 공급 현황'으로 바뀌고, 그 기관의 충전기가
// 0기인 지역은 사라지지 않고 '미진출'로 남아야 한다(국가 인프라 부족과 다른 상태).
await page.getByRole("button", { name: "상위 10개 선택" }).click();
await page.getByRole("heading", { name: "선택 운영기관 공급 현황" }).waitFor({ timeout: 5000 });

const scoped = await page.locator("aside div").filter({ hasText: /^[\d,]+$/ }).first().innerText();
if (scoped === expected) throw new Error("운영기관 필터가 충전기 수를 바꾸지 않았습니다");

// 표의 '미진출' 셀만 센다. getByText 는 하단 주석 문구에도 걸려 0건이어도 통과한다.
const absent = await page.locator("td", { hasText: /^미진출$/ }).count();
console.log(`상위 10개 기관 기준 미진출 지역: ${absent}곳`);
await shotHelper();

async function shotHelper() {
  await page.waitForTimeout(1200); // 차트 전환 애니메이션이 끝난 뒤에 찍는다
  await page.screenshot({ path: "../.omc/artifacts/prototype-operator.png" });
}

// 소규모 기관을 하나만 고르면 그 기관이 들어가지 않은 지역이 나온다.
// 이 지역들은 결과에서 사라지지 않고 '미진출'로 남아야 한다(사용자 스토리 25·26).
const operators = JSON.parse(readFileSync("public/data/operators.json", "utf8"));
const rare = operators[operators.length - 1];

await page.getByRole("button", { name: "해제" }).click();
await page.getByLabel("운영기관 검색").fill(rare);
await page.getByRole("checkbox", { name: rare, exact: false }).first().check();

const rareAbsent = await page.locator("td", { hasText: /^미진출$/ }).count();
if (rareAbsent === 0) {
  throw new Error(`소규모 기관 '${rare}' 을 골랐는데 미진출 지역이 표시되지 않습니다`);
}
console.log(`소규모 기관 '${rare}' 선택 시 미진출 지역: ${rareAbsent}곳 (표에서 사라지지 않음)`);

await page.getByRole("button", { name: "전체 초기화" }).click();
await page.getByRole("heading", { name: "충전 인프라 부족 지역" }).waitFor({ timeout: 5000 });

const shot = async (w, h, name) => {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(700); // 지도 리사이즈
  await page.screenshot({ path: `../.omc/artifacts/${name}`, fullPage: false });
};

await shot(1440, 960, "prototype-1440.png");
await shot(768, 1024, "prototype-768.png");
await shot(360, 780, "prototype-360.png");

// 가로 스크롤은 승인 기준의 실패 조건이다.
for (const w of [1440, 768, 360]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error(`${w}px 에서 가로 스크롤 발생`);
}

await browser.close();

if (errors.length) {
  console.error("콘솔 오류:", errors);
  process.exit(1);
}
console.log(`SMOKE PASS — KPI 충전기 ${chargers}기 (파이프라인 일치), 첫 렌더 ${(ready / 1000).toFixed(2)}s`);
console.log("가로 스크롤: 1440/768/360px 모두 없음");
