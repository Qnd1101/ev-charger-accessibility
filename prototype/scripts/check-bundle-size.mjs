// 번들 크기 회귀 감시. GitHub 이슈 #1: ECharts 모듈 임포트를 유지하고,
// 프로덕션 JS 총량을 기록하며, 전체 패키지 임포트로의 회귀를 차단한다.
//
// 전제: 이 스크립트 이전에 `npm run build`가 실행되어 dist/ 가 최신이라고 가정한다.
// (스크립트는 빌드를 호출하지 않는다.) Node 빌트인만 사용한다.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "dist", "assets");

// 크기 상한. 측정 기준선(모듈 임포트 빌드)은 1,447,538 bytes 였다.
// 상한은 그 약 115%로 잡아, 소소한 증가는 허용하되 전체 패키지 임포트
// 같은 큰 회귀(측정상 2,032,605 bytes)는 확실히 걸리도록 한다.
// 1,447,538 * 1.15 = 1,664,668 (반올림).
const CEILING_BYTES = 1_664_668;

// 전체 패키지 임포트(`import * as echarts from "echarts"`) 회귀 신호.
// 이 문자열들은 개별 차트 구현 코드에서만 나온다(파이 roseType, 라인 showAllSymbol,
// 그래프 circularRotateLabel, 생키 nodeAlign, 트리맵 leafDepth 등). 미니파이 후에도
// 시리즈 옵션 키로 살아남는다. 코어/i18n 에는 없어 모듈 임포트 빌드에는 0회 등장한다.
// BarChart 만 등록하는 현재 빌드에는 없어야 하며, 하나라도 발견되면 회귀로 본다.
const FULL_PACKAGE_MARKERS = [
  "roseType",
  "showAllSymbol",
  "circularRotateLabel",
  "nodeAlign",
  "leafDepth",
  "singleAxisPointer",
];

function readJsFiles() {
  let entries;
  try {
    entries = readdirSync(assetsDir);
  } catch {
    console.error(`[check-bundle-size] dist/assets 를 읽을 수 없습니다: ${assetsDir}`);
    console.error("[check-bundle-size] 먼저 `npm run build` 를 실행하세요.");
    process.exit(1);
  }
  const jsFiles = entries.filter((f) => f.endsWith(".js"));
  if (jsFiles.length === 0) {
    console.error("[check-bundle-size] dist/assets 에 JS 청크가 없습니다. 빌드를 먼저 실행하세요.");
    process.exit(1);
  }
  return jsFiles.map((f) => ({ name: f, path: join(assetsDir, f) }));
}

const files = readJsFiles();
let total = 0;
for (const f of files) total += statSync(f.path).size;

console.log("[check-bundle-size] JS 청크:");
for (const f of files) console.log(`  ${f.name}  ${statSync(f.path).size.toLocaleString()} bytes`);
console.log(`[check-bundle-size] 측정 JS 총량: ${total.toLocaleString()} bytes`);
console.log(`[check-bundle-size] 상한: ${CEILING_BYTES.toLocaleString()} bytes`);

let failed = false;

// 신호 가드: 전체 패키지 임포트 흔적 탐지.
const hits = [];
for (const f of files) {
  const text = readFileSync(f.path, "utf8");
  for (const marker of FULL_PACKAGE_MARKERS) {
    if (text.includes(marker)) hits.push(`${marker} (in ${f.name})`);
  }
}
if (hits.length > 0) {
  failed = true;
  console.error("[check-bundle-size] 회귀 감지: 전체 패키지 ECharts 임포트 신호가 발견되었습니다.");
  console.error("[check-bundle-size] 발견된 마커: " + hits.join(", "));
  console.error('[check-bundle-size] RankingChart 는 echarts/core + echarts/charts 모듈 임포트를 사용해야 합니다.');
}

// 크기 가드.
if (total > CEILING_BYTES) {
  failed = true;
  console.error(
    `[check-bundle-size] 크기 초과: ${total.toLocaleString()} > ${CEILING_BYTES.toLocaleString()} bytes ` +
      `(+${(total - CEILING_BYTES).toLocaleString()})`,
  );
}

if (failed) {
  console.error("[check-bundle-size] FAIL");
  process.exit(1);
}

console.log("[check-bundle-size] PASS");
