/**
 * 지표 평가기.
 *
 * **여기에 공식은 없다.** 공식은 Python(`src/metric_specs.py`)이 `metrics.json` 으로
 * 내보내고, 이 파일은 그 표를 읽어 나누기만 한다. 지표를 추가·수정할 때 이 파일은
 * 손대지 않는다 -- 손대야 한다면 경계가 잘못된 것이다(AGENTS.md, DESIGN.md 데이터 경계).
 *
 * 다섯 지표가 전부 "합산 가능한 두 수의 비율"이라 이게 가능하다. 큐브가 다섯 카운트를
 * 모든 슬라이스에 싣고 있으므로 특수 분기가 필요 없다 -- 급속 슬라이스 안에서는
 * fast_count == charger_count 라서 급속 비율이 저절로 100% 가 된다.
 */

/** 지표의 분자 또는 분모. 언제나 합산 가능한 수 하나를 가리킨다. */
export interface Term {
  field: TermField;
  scale: number;
}

/** 큐브에서 오는 카운트 + 지역에 붙는 정적 속성. 이름은 Python 과 같아야 한다. */
export type TermField =
  | "charger_count"
  | "station_count"
  | "fast_count"
  | "live_count"
  | "available_count"
  | "population"
  | "ev_count";

export type Polarity = "low_is_vulnerable" | "high_is_vulnerable" | "neutral";

export interface MetricSpec {
  id: string;
  label: string;
  unit: string;
  isRatio: boolean;
  numerator: Term;
  denominator: Term;
  decimals: number;
  polarity: Polarity;
  resolution: "sido" | "sigungu";
  definition: string;
  caveat: string | null;
}

/** 지표를 계산할 수 있는 항의 묶음. 인구·EV 는 지역에 따라 없을 수 있다. */
export type Terms = Partial<Record<TermField, number>>;

/** 분모가 0이거나 항이 없으면 null. inf 를 남기면 랭킹 최상위를 조용히 차지한다. */
export function evaluate(spec: MetricSpec, t: Terms): number | null {
  const num = t[spec.numerator.field];
  const denRaw = t[spec.denominator.field];
  if (num === undefined || denRaw === undefined) return null;

  const den = denRaw / spec.denominator.scale;
  if (den <= 0) return null;
  return num / spec.numerator.scale / den;
}

/** 숫자 표기 규칙은 DESIGN.md 콘텐츠 문체: 비율은 소수점 한 자리, 개수는 천 단위 구분. */
export function format(spec: MetricSpec, value: number | null): string {
  if (value === null) return "—";
  const shown = spec.isRatio ? value * 100 : value;
  return shown.toLocaleString("ko-KR", {
    minimumFractionDigits: spec.decimals,
    maximumFractionDigits: spec.decimals,
  });
}

/** 취약 방향. 랭킹 정렬·색 방향·3D 높이 방향이 전부 여기서 파생된다(ADR 0001). */
export function isVulnerableFirst(spec: MetricSpec): boolean {
  return spec.polarity === "low_is_vulnerable";
}

export function byId(specs: MetricSpec[], id: string): MetricSpec {
  const found = specs.find((s) => s.id === id);
  if (!found) throw new Error(`metrics.json 에 ${id} 정의가 없습니다.`);
  return found;
}
