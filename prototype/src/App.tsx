/**
 * Split Command — 한 화면.
 *
 * **지표 공식은 여기에 없다.** `metrics.json`(Python 이 내보낸 정의)을 읽어 `evaluate` 로
 * 계산한다. 값·단위·소수점·툴팁·취약 방향이 전부 정의에서 나온다(AGENTS.md 데이터 경계).
 */
import { useEffect, useMemo, useState } from "react";

import s from "./App.module.css";
import DataProvenance from "./DataProvenance";
import DistributionMap, { type MapView } from "./DistributionMap";
import RankingChart, { type RankRow } from "./RankingChart";
import {
  EMPTY_FILTERS,
  SPEED,
  aggregateGrid,
  aggregateRegions,
  aggregateStatusDistribution,
  loadDataset,
  totalTerms,
  type Dataset,
  type Filters,
  type SpeedFilter,
  type Terms,
} from "./data";
import { byId, evaluate, format } from "./metrics";

const RANK_SIZE = 12;
const OP_LIST_CAP = 60;
const num = (n: number) => n.toLocaleString("ko-KR");

/**
 * 랭킹 축의 시도 축약. 앞 두 글자만 자르면 전라남도/전라북도가 똑같이 '전라'가 되어
 * 서로 다른 지역이 한 축에서 구분되지 않는다. 관용 축약(전남·경북…)을 쓴다.
 */
function shortSido(name: string): string {
  return /^(전라|경상|충청)/.test(name) ? name[0] + name[2] : name.slice(0, 2);
}

const SPEED_LABELS: [SpeedFilter, string][] = [
  [SPEED.ALL, "전체"],
  [SPEED.FAST, "급속만"],
  [SPEED.SLOW, "완속만"],
];

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [opQuery, setOpQuery] = useState("");
  const [view, setView] = useState<MapView>("region");
  // 기본값 M2(기존 동작·하위 호환 유지). M1은 시도 해상도, M2는 시군구 해상도(metrics.json).
  const [rankMetricId, setRankMetricId] = useState<"M1" | "M2">("M2");

  useEffect(() => {
    setError(null);
    loadDataset().then(setData, (caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "집계 데이터를 불러오는 중 알 수 없는 오류가 발생했습니다.");
    });
  }, [loadAttempt]);

  const totals = useMemo(() => (data ? aggregateRegions(data, f) : null), [data, f]);
  const cells = useMemo(() => (data ? aggregateGrid(data, f) : []), [data, f]);
  const scopeTerms = useMemo<Terms | null>(
    () => (data && totals ? totalTerms(data, f, totals) : null),
    [data, f, totals],
  );

  const nationalTotals = useMemo(
    () => (data ? aggregateRegions(data, EMPTY_FILTERS) : null),
    [data],
  );

  /** 개요 패널의 충전기 상태 분포 표. 합계는 위 '충전기' KPI와 일치해야 한다(같은 큐브 키). */
  const statusRows = useMemo(() => {
    if (!data) return [];
    const counts = aggregateStatusDistribution(data, f);
    return data.statusCube.labels
      .map((label, i) => ({ label, count: counts[i] ?? 0 }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [data, f]);

  /**
   * 접근성 취약 랭킹. 지표(M1/M2)의 정의·단위·정렬 방향은 `metrics.json` 에서 온다.
   *
   * M2(시군구 해상도)는 인구가 시군구 단위로 있으면 시군구를, 시도로 떨어졌으면 시도를
   * 세운다. 예전에는 시군구만 세워서, 인구가 시도로 떨어지면 배지는 "시도 · M2"라고
   * 말하는데 표는 **조용히 비었다**. M1(EV1000대당)은 한전 통계 자체가 시도 단위라 항상
   * 시도로 세운다.
   *
   * 운영기관을 고르면 0기 지역이 생기는데, 이건 국가 인프라 '부족'이 아니라 그 기관의
   * '미진출'이다. 결과에서 지우지 않고 다른 상태로 표시한다(CONTEXT.md 용어 구분).
   */
  const ranking = useMemo<RankRow[]>(() => {
    if (!data || !totals) return [];
    const inScope = (zcode: number) => !f.zcodes.length || f.zcodes.includes(zcode);
    const absent = (t: Terms) => t.charger_count === 0 && f.operators.length > 0;

    const byZcode = () => {
      const acc = new Map<number, Terms>();
      const zOf = new Map(data.regions.map((r) => [r.zscode, r.zcode]));
      for (const [zscode, t] of totals) {
        const z = zOf.get(zscode);
        if (z === undefined) continue;
        const cur = acc.get(z) ?? { charger_count: 0 };
        cur.charger_count! += t.charger_count ?? 0;
        acc.set(z, cur);
      }
      return acc;
    };

    if (rankMetricId === "M1") {
      const m1 = byId(data.metrics, "M1");
      const chargersByZcode = byZcode();
      return data.sidos
        .filter((sd) => inScope(sd.zcode))
        .map((sd) => {
          const t: Terms = { ...(chargersByZcode.get(sd.zcode) ?? { charger_count: 0 }), ev_count: sd.ev_count };
          return { name: sd.name, value: evaluate(m1, t), absent: absent(t) };
        })
        .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
        .slice(0, RANK_SIZE);
    }

    const m2 = byId(data.metrics, "M2");
    const sggRows = data.regions
      .filter((r) => inScope(r.zcode) && r.population)
      .map((r) => {
        const t: Terms = {
          ...(totals.get(r.zscode) ?? { charger_count: 0 }),
          population: r.population!,
        };
        return { name: `${shortSido(r.sido)} ${r.sigungu}`, value: evaluate(m2, t), absent: absent(t) };
      });
    if (sggRows.length) return sggRows.sort((a, b) => (a.value ?? 0) - (b.value ?? 0)).slice(0, RANK_SIZE);

    // 시군구 인구가 없다 -> 시도로 강등한다. 빈 표를 내놓지 않는다.
    const chargersByZcode = byZcode();
    return data.sidos
      .filter((sd) => inScope(sd.zcode) && sd.population)
      .map((sd) => {
        const t: Terms = { ...(chargersByZcode.get(sd.zcode) ?? { charger_count: 0 }), population: sd.population! };
        return { name: sd.name, value: evaluate(m2, t), absent: absent(t) };
      })
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
      .slice(0, RANK_SIZE);
  }, [data, totals, f.zcodes, f.operators.length, rankMetricId]);

  const opCounts = useMemo(() => {
    if (!data) return new Map<number, number>();
    const m = new Map<number, number>();
    for (const [, op, speed, h24, chargers] of data.regionCube) {
      if (speed !== SPEED.ALL || h24 !== 0) continue;
      m.set(op, (m.get(op) ?? 0) + chargers);
    }
    return m;
  }, [data]);

  /**
   * 지도 값도 Python이 내보낸 M2 정의를 evaluate한다. 여기서는 극성에 따라 색·높이용
   * 취약 방향만 맞추며, 필터가 바뀌어도 무필터 전국 범위를 고정한다.
   */
  const mapMetric = useMemo(() => {
    if (!data || !totals || !nationalTotals) {
      return { regionValues: [], fixedVulnerabilityMax: undefined };
    }
    const spec = byId(data.metrics, "M2");
    const valuesFor = (regionTotals: Map<number, Terms>) => data.regions.map((region) => {
      const terms: Terms = {
        ...(regionTotals.get(region.zscode) ?? {}),
        ...(region.population == null ? {} : { population: region.population }),
      };
      return { zscode: region.zscode, value: evaluate(spec, terms) };
    });
    const national = valuesFor(nationalTotals);
    const valid = national.flatMap(({ value }) => value == null ? [] : [value]);
    if (!valid.length || spec.polarity === "neutral") {
      return {
        regionValues: valuesFor(totals).map((region) => ({ ...region, vulnerability: null })),
        fixedVulnerabilityMax: undefined,
      };
    }

    const lower = Math.min(...valid);
    const upper = Math.max(...valid);
    const fixedVulnerabilityMax = upper - lower;
    const vulnerabilityOf = (value: number | null) => {
      if (value == null) return null;
      const directed = spec.polarity === "low_is_vulnerable" ? upper - value : value - lower;
      return Math.min(fixedVulnerabilityMax, Math.max(0, directed));
    };
    return {
      regionValues: valuesFor(totals).map((region) => ({
        ...region,
        vulnerability: vulnerabilityOf(region.value),
      })),
      fixedVulnerabilityMax,
    };
  }, [data, nationalTotals, totals]);

  if (error) {
    return (
      <main className={s.canvas}>
        <div className={s.error}>
          <h1 className={s.h1}>집계 데이터를 읽지 못했습니다</h1>
          <p>
            정적 집계 파일을 불러오는 단계에서 실패했습니다. {error}
          </p>
          <p className={s.kpiNote}>
            파일이 없거나 손상됐다면 <code>python scripts/build_web_data.py</code>로 다시 생성할 수 있습니다.
          </p>
          <button type="button" className={s.errorRetry} onClick={() => setLoadAttempt((n) => n + 1)}>
            데이터 다시 불러오기
          </button>
        </div>
      </main>
    );
  }

  if (!data || !scopeTerms || !totals) {
    return (
      <div className={s.shell}>
        <aside className={s.rail}>
          <p className={s.railTitle}>CONTROL DECK</p>
          <p className={s.railSub}>집계를 불러오는 중…</p>
        </aside>
        <main className={s.canvas}>
          <div className={s.kpis}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={s.kpi}>
                <div className={s.skeleton} />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  const { meta, operators, sidos } = data;
  const opFiltered = f.operators.length > 0;
  const chargers = scopeTerms.charger_count ?? 0;
  const stations = scopeTerms.station_count ?? 0;
  const rankSpec = rankMetricId === "M1" ? byId(data.metrics, "M1") : byId(data.metrics, "M2");
  const rankResolutionLabel = rankMetricId === "M1" ? "시도" : (meta.population_label ?? "시군구");
  const ratioKpis = [byId(data.metrics, "M3"), byId(data.metrics, "M5")];
  // 시군구·시도 어느 해상도로도 인구가 없으면 M2 를 계산할 수 없다(Streamlit tab_access 대응).
  // M1 은 인구가 아니라 EV 등록 대수를 쓰므로 이 제약과 무관하다.
  const noPopulationData =
    rankMetricId === "M2" &&
    !data.regions.some((r) => r.population != null) &&
    !data.sidos.some((s) => s.population != null);
  // 목록은 60개에서 자른다(가상 스크롤 없이 335개를 심으면 렌더·스크롤 비용이 커진다).
  // 잘렸다는 사실은 사용자에게 알린다. 이미 클라이언트에 있는 배열 길이만 쓴다.
  const matchedOps = operators
    .map((name, i) => ({ name, i }))
    .filter((o) => (opQuery ? o.name.includes(opQuery) : true));
  const visibleOps = matchedOps.slice(0, OP_LIST_CAP);
  const unplacedChargers =
    "unplaced_chargers" in meta && typeof meta.unplaced_chargers === "number"
      ? meta.unplaced_chargers
      : 0;

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const chips = [
    ...f.zcodes.map((z) => ({
      key: `z${z}`,
      label: sidos.find((x) => x.zcode === z)?.name ?? String(z),
      clear: () => setF({ ...f, zcodes: f.zcodes.filter((x) => x !== z) }),
    })),
    ...(f.speed !== SPEED.ALL
      ? [{
          key: "speed",
          label: SPEED_LABELS.find(([v]) => v === f.speed)![1],
          clear: () => setF({ ...f, speed: SPEED.ALL }),
        }]
      : []),
    ...f.operators.map((i) => ({
      key: `o${i}`,
      label: operators[i],
      clear: () => setF({ ...f, operators: f.operators.filter((x) => x !== i) }),
    })),
    ...(f.only24h
      ? [{ key: "h24", label: "24시간 이용가능", clear: () => setF({ ...f, only24h: false }) }]
      : []),
  ];

  const emptyReasons = [
    f.zcodes.length > 0
      ? `선택 지역: ${f.zcodes.map((z) => sidos.find((sd) => sd.zcode === z)?.name ?? z).join(", ")}`
      : null,
    f.operators.length > 0
      ? `선택 운영기관: ${f.operators.map((i) => operators[i]).join(", ")}`
      : null,
    f.speed !== SPEED.ALL
      ? `충전 속도: ${SPEED_LABELS.find(([value]) => value === f.speed)?.[1]}`
      : null,
    f.only24h ? "이용 시간: 24시간 이용가능만" : null,
  ].filter((reason): reason is string => reason !== null);

  const filterDimensions = [
    f.zcodes.length > 0
      ? { key: "region", label: "지역", relaxed: { ...f, zcodes: [] } }
      : null,
    f.operators.length > 0
      ? { key: "operator", label: "운영기관", relaxed: { ...f, operators: [] } }
      : null,
    f.speed !== SPEED.ALL
      ? { key: "speed", label: "충전 속도", relaxed: { ...f, speed: SPEED.ALL } }
      : null,
    f.only24h
      ? { key: "hours", label: "이용 시간", relaxed: { ...f, only24h: false } }
      : null,
  ].filter((dimension): dimension is { key: string; label: string; relaxed: Filters } => dimension !== null)
    .map((dimension) => {
      const relaxedTotals = aggregateRegions(data, dimension.relaxed);
      const restored = (totalTerms(data, dimension.relaxed, relaxedTotals).charger_count ?? 0) > 0;
      return { ...dimension, restored };
    });
  const individuallyRecoverable = filterDimensions.filter((dimension) => dimension.restored);

  return (
    <div className={s.shell}>
      <aside className={s.rail}>
        <h2 className={s.railTitle}>CONTROL DECK</h2>
        <p className={s.railSub}>필터를 바꾸면 KPI·지도·순위가 함께 갱신됩니다.</p>

        <fieldset className={s.field}>
          <legend>시도</legend>
          <div className={s.checkList}>
            {sidos.map((sd) => (
              <label key={sd.zcode}>
                <input
                  type="checkbox"
                  checked={f.zcodes.includes(sd.zcode)}
                  onChange={() => setF({ ...f, zcodes: toggle(f.zcodes, sd.zcode) })}
                />
                {sd.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={s.field}>
          <legend>충전 속도</legend>
          <div className={s.segment}>
            {SPEED_LABELS.map(([v, label]) => (
              <label key={v}>
                <input
                  type="radio"
                  name="speed"
                  checked={f.speed === v}
                  onChange={() => setF({ ...f, speed: v })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={s.field}>
          <legend>운영기관 ({operators.length}곳)</legend>
          <input
            className={s.search}
            type="search"
            placeholder="기관명 검색"
            value={opQuery}
            onChange={(e) => setOpQuery(e.target.value)}
            aria-label="운영기관 검색"
          />
          <div className={s.quick}>
            <button
              type="button"
              className={s.quickBtn}
              onClick={() =>
                setF({
                  ...f,
                  operators: meta.top_operators.map((n) => operators.indexOf(n)),
                })
              }
            >
              상위 10개 선택
            </button>
            {opFiltered && (
              <button type="button" className={s.quickBtn} onClick={() => setF({ ...f, operators: [] })}>
                해제
              </button>
            )}
          </div>
          <div className={s.checkList}>
            {visibleOps.map((o) => (
              <label key={o.i}>
                <input
                  type="checkbox"
                  checked={f.operators.includes(o.i)}
                  onChange={() => setF({ ...f, operators: toggle(f.operators, o.i) })}
                />
                {o.name}
                <span className={s.count}>{num(opCounts.get(o.i) ?? 0)}</span>
              </label>
            ))}
          </div>
          {matchedOps.length > OP_LIST_CAP && (
            <p className={s.listNote}>
              총 {num(matchedOps.length)}곳 중 {num(OP_LIST_CAP)}곳 표시 · 검색으로 좁혀보세요
            </p>
          )}
        </fieldset>

        <fieldset className={s.field}>
          <legend>이용 시간</legend>
          <label style={{ display: "flex", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={f.only24h}
              onChange={(e) => setF({ ...f, only24h: e.target.checked })}
            />
            24시간 이용가능만
          </label>
        </fieldset>

        <div className={s.railResult}>
          <div className={s.railResultValue} aria-live="polite">
            {num(chargers)}
          </div>
          <div className={s.railResultLabel}>필터 후 충전기</div>
          <button
            type="button"
            className={s.reset}
            style={{ marginTop: 12 }}
            onClick={() => {
              setF(EMPTY_FILTERS);
              setOpQuery("");
            }}
          >
            전체 초기화
          </button>
        </div>
        <DataProvenance />
      </aside>

      <main className={s.canvas}>
        <p className={s.kicker}>Korea EV Infrastructure Observatory</p>
        <h1 className={s.h1}>대한민국 충전 인프라 관제</h1>

        <div className={s.basis}>
          <span>
            충전기 <b>{meta.snapshot_date}</b> 스냅샷
          </span>
          <span>
            전기차 등록 <b>{meta.ev_date}</b>
          </span>
          <span>
            인구 <b>{meta.population_date ?? "N/A"}</b>
            {meta.population_label && ` · ${meta.population_label} 해상도`}
          </span>
          <span className={s.boundary}>
            충전 데이터는 로컬 파일에서만 읽습니다. 외부 통신은 배경지도 타일뿐입니다.
          </span>
        </div>

        <div className={s.scope}>
          <span className={s.scopeLabel}>ACTIVE SCOPE</span>
          {chips.length === 0 ? (
            <span className={s.chip}>전국 · 전체 운영기관</span>
          ) : (
            chips.map((c) => (
              <span key={c.key} className={s.chip}>
                {c.label}
                <button type="button" className={s.chipX} onClick={c.clear} aria-label={`${c.label} 필터 제거`}>
                  ×
                </button>
              </span>
            ))
          )}
        </div>

        {chargers === 0 ? (
          <div className={s.empty} role="status" aria-live="polite">
            <h2 className={s.panelTitle}>조건에 맞는 충전기가 0기입니다</h2>
            <p className={s.kpiNote}>다음 조건의 교집합에 등록된 충전기가 없습니다.</p>
            <ul className={s.emptyReasons}>
              {emptyReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
            <h3 className={s.emptyGuideTitle}>복구 가능한 조건</h3>
            <ul className={s.recoveryList}>
              {filterDimensions.map((dimension) => (
                <li key={dimension.key}>
                  <span>
                    {dimension.label}: {dimension.restored ? "이 조건만 완화하면 결과가 복구됩니다." : "이 조건만 완화해도 0기입니다."}
                  </span>
                  {dimension.restored && (
                    <button
                      type="button"
                      className={s.recoveryBtn}
                      onClick={() => setF(dimension.relaxed)}
                    >
                      {dimension.label} 조건 해제
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className={s.kpiNote}>
              {filterDimensions.length === 1
                ? individuallyRecoverable.length > 0
                  ? "현재 0건은 단일 조건에서 발생했습니다. 이 조건을 완화하면 결과가 복구됩니다."
                  : "현재 0건은 단일 조건에서 발생했지만 이 차원 전체를 완화해도 복구되지 않습니다. 데이터를 확인하세요."
                : individuallyRecoverable.length > 0
                  ? "현재 0건은 여러 조건의 교집합에서 발생했습니다. ‘복구됩니다’로 표시된 조건 하나를 완화할 수 있습니다."
                  : "단일 조건 완화만으로 복구되지 않는 조합 원인입니다. 여러 조건을 함께 완화하거나 모든 필터를 해제하세요."}
            </p>
            <button
              type="button"
              className={s.quickBtn}
              onClick={() => {
                setF(EMPTY_FILTERS);
                setOpQuery("");
              }}
            >
              모든 필터 해제
            </button>
          </div>
        ) : (
          <>
            <section className={s.kpis} aria-label="핵심 지표">
              <div className={s.kpi}>
                <div className={s.kpiLabel}>충전소</div>
                <div className={s.kpiValue}>
                  {num(stations)}
                  <span className={s.kpiUnit}>개소</span>
                </div>
                <p className={s.kpiNote}>
                  {f.operators.length > 1 || f.zcodes.length > 1
                    ? `여러 지역·기관에 걸친 충전소가 최대 ${num(meta.station_overcount_max)}개 중복 계상될 수 있습니다.`
                    : "동일 statId 를 하나로 셉니다."}
                </p>
              </div>
              <div className={s.kpi}>
                <div className={s.kpiLabel}>충전기</div>
                <div className={s.kpiValue}>
                  {num(chargers)}
                  <span className={s.kpiUnit}>기</span>
                </div>
                <p className={s.kpiNote}>커넥터 단위. 전국 {num(meta.total_chargers)}기 중.</p>
              </div>
              {ratioKpis.map((spec) => (
                <div key={spec.id} className={s.kpi}>
                  <div className={s.kpiLabel}>
                    {spec.label} ({spec.id})
                  </div>
                  <div className={s.kpiValue} title={spec.definition}>
                    {format(spec, evaluate(spec, scopeTerms))}
                    <span className={s.kpiUnit}>{spec.unit}</span>
                  </div>
                  <p className={s.kpiNote}>{spec.caveat ?? spec.definition}</p>
                </div>
              ))}
            </section>

            <section className={s.panel} aria-label="충전기 상태 분포">
              <div className={s.panelHead}>
                <h2 className={s.panelTitle}>충전기 상태 분포</h2>
                <span className={s.badge}>{num(chargers)}기 기준</span>
              </div>
              <div className={s.tableWrap}>
                <table>
                  <caption>
                    선택한 필터 범위의 충전기를 상태별로 센 표입니다. 합계는 위 &lsquo;충전기&rsquo; 지표와 일치해야
                    합니다.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">상태</th>
                      <th scope="col">충전기 수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusRows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" style={{ fontWeight: 400 }}>
                          {row.label}
                        </th>
                        <td className={s.num}>{num(row.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className={s.split}>
              <section className={s.panel} aria-label="충전기 분포">
                <div className={s.panelHead}>
                  <h2 className={s.panelTitle}>충전기 분포</h2>
                  <span className={s.badge}>
                    {view === "region" ? "시군구 코로플레스" : view === "grid" ? "2km 격자" : "밀도 히트맵"}
                  </span>
                  <div className={s.toggle} role="group" aria-label="지도 표시 방식">
                    {(["region", "grid", "heat"] as MapView[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={s.quickBtn}
                        aria-pressed={view === v}
                        style={
                          view === v
                            ? { borderColor: "var(--ink)", color: "var(--ink)", fontWeight: 600 }
                            : undefined
                        }
                        onClick={() => setView(v)}
                      >
                        {v === "region" ? "코로플레스" : v === "grid" ? "격자" : "히트맵"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={s.map}>
                  <DistributionMap
                    cells={cells}
                    view={view}
                    gridDeg={meta.grid_deg}
                    regionValues={mapMetric.regionValues}
                    fixedVulnerabilityMax={mapMetric.fixedVulnerabilityMax}
                  />
                </div>
                <p className={s.caveat}>
                  지도는 셀 {num(cells.length)}개로 집계된 값입니다. 좌표가 무효한 충전기{" "}
                  {num(meta.invalid_coord_chargers)}기는 <b>지도에서만 빠지고</b> 위 집계에는 포함됩니다.
                  {unplacedChargers > 0 && (
                    <> 지역에 배치할 수 없는 충전기 {num(unplacedChargers)}기도 지역·지도 집계에서 제외됩니다.</>
                  )}
                </p>
                {cells.length === 0 && (
                  <p className={s.kpiNote}>필터 조건에 맞는 충전기 중 지도에 표시할 수 있는 좌표가 없습니다.</p>
                )}
              </section>

              <section className={s.panel} aria-label="취약 지역 순위">
                <div className={s.panelHead}>
                  <h2 className={s.panelTitle}>
                    {opFiltered ? "선택 운영기관 공급 현황" : "충전 인프라 부족 지역"}
                  </h2>
                  <span className={s.badge}>{rankResolutionLabel} · {rankMetricId}</span>
                  <div className={s.toggle} role="group" aria-label="랭킹 지표 선택">
                    {(["M1", "M2"] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={s.quickBtn}
                        aria-pressed={rankMetricId === id}
                        style={
                          rankMetricId === id
                            ? { borderColor: "var(--ink)", color: "var(--ink)", fontWeight: 600 }
                            : undefined
                        }
                        onClick={() => setRankMetricId(id)}
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                </div>
                {noPopulationData ? (
                  <div className={s.empty} role="status">
                    <h3 className={s.emptyGuideTitle}>인구 데이터가 없어 이 지표를 계산할 수 없습니다.</h3>
                    <p className={s.kpiNote}>
                      jumin.mois.go.kr → 주민등록 인구 및 세대현황 → 월간에서 CSV 를 받아{" "}
                      <code>data/raw/</code>에 넣고 <code>python src/metrics.py</code>와{" "}
                      <code>python scripts/build_web_data.py</code>를 다시 실행하세요.
                    </p>
                    <ul className={s.emptyReasons}>
                      <li>행정구역을 시군구까지 펼치면 → <code>jumin_sgg_202606.csv</code>(고해상도)</li>
                      <li>시도만 접어서 받으면 → <code>jumin_sido_202606.csv</code>(저해상도)</li>
                    </ul>
                  </div>
                ) : (
                  <>
                    <div className={s.chart}>
                      <RankingChart rows={ranking} unit={rankSpec.unit} />
                    </div>

                    <div className={s.tableWrap}>
                      <table>
                        <caption>
                          {rankSpec.definition} <b>낮을수록 접근성이 취약</b>합니다. 오름차순 상위 {RANK_SIZE}곳.
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">지역</th>
                            <th scope="col">
                              {rankSpec.id} ({rankSpec.unit})
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ranking.map((r) => (
                            <tr key={r.name}>
                              <th scope="row" style={{ fontWeight: 400 }}>
                                {r.name}
                              </th>
                              <td className={s.num}>
                                {r.absent ? <span className={s.absent}>미진출</span> : format(rankSpec, r.value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className={s.caveat}>
                      {opFiltered
                        ? "‘미진출’은 선택한 운영기관의 충전기가 0기라는 뜻입니다. 국가 인프라 부족과 다릅니다."
                        : rankSpec.caveat}
                    </p>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
