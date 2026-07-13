/**
 * 정적 희소 집계 계약이 내려주는 알려진 데이터 파일 화이트리스트.
 * `network.spec.ts`와 `performance.spec.ts`가 공유한다 -- 51만 원본 충전기
 * 배열이나 그 밖의 원본류 엔드포인트(chargers*.json, *_clean* 등)가 새로
 * 생기면 두 시드(요청 가로채기, 전송 바이트 실측) 모두 이 목록으로 판정한다.
 */
export const KNOWN_DATA_FILES = new Set([
  "meta.json",
  "metrics.json",
  "operators.json",
  "regions.json",
  "region_cube.json",
  "grid_cube.json",
  "sigungu.topo.json",
]);
