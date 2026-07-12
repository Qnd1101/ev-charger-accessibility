/**
 * Split Command 프로토타입 — 한 화면.
 *
 * DESIGN.md 의 프로토타입 범위: 헤더, 기준일, 필터 4개, KPI 4개, 2D 격자 지도, 취약 지역 랭킹.
 * 폐기 가능한 코드다. 구조와 시각 언어를 1440px·768px 에서 승인받는 것이 목적이다.
 */
import { useEffect, useMemo, useState } from "react";

import s from "./App.module.css";
import DistributionMap, { type MapView } from "./DistributionMap";
import RankingChart, { type RankRow } from "./RankingChart";
import {
  EMPTY_FILTERS,
  SPEED,
  aggregateGrid,
  aggregateRegions,
  computeKpis,
  loadDataset,
  type Dataset,
  type Filters,
  type SpeedFilter,
} from "./data";

const RANK_SIZE = 12;
const num = (n: number) => n.toLocaleString("ko-KR");
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

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
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [opQuery, setOpQuery] = useState("");
  const [view, setView] = useState<MapView>("grid");

  useEffect(() => {
    loadDataset().then(setData, (e: Error) => setError(e.message));
  }, []);

  const totals = useMemo(() => (data ? aggregateRegions(data, f) : null), [data, f]);
  const cells = useMemo(() => (data ? aggregateGrid(data, f) : []), [data, f]);
  const kpis = useMemo(
    () => (data && totals ? computeKpis(data, f, totals) : null),
    [data, f, totals],
  );

  /**
   * M2(인구 10만명당 충전기) 오름차순 = 접근성 취약 랭킹.
   * 운영기관을 고르면 0기 지역이 생기는데, 이건 국가 인프라 '부족'이 아니라 그 기관의
   * '미진출'이다. 결과에서 지우지 않고 다른 상태로 표시한다(CONTEXT.md 용어 구분).
   */
  const ranking = useMemo<RankRow[]>(() => {
    if (!data || !totals) return [];
    const scoped = f.zcodes.length
      ? data.regions.filter((r) => f.zcodes.includes(r.zcode))
      : data.regions;

    return scoped
      .filter((r) => r.population)
      .map((r) => {
        const chargers = totals.get(r.zscode)?.chargers ?? 0;
        return {
          name: `${shortSido(r.sido)} ${r.sigungu}`,
          value: chargers / (r.population! / 100_000),
          absent: chargers === 0 && f.operators.length > 0,
        };
      })
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
      .slice(0, RANK_SIZE);
  }, [data, totals, f.zcodes, f.operators.length]);

  const opCounts = useMemo(() => {
    if (!data) return new Map<number, number>();
    const m = new Map<number, number>();
    for (const [, op, speed, h24, chargers] of data.regionCube) {
      if (speed !== SPEED.ALL || h24 !== 0) continue;
      m.set(op, (m.get(op) ?? 0) + chargers);
    }
    return m;
  }, [data]);

  if (error) {
    return (
      <main className={s.canvas}>
        <div className={s.error}>
          <h1 className={s.h1}>집계 데이터를 읽지 못했습니다</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!data || !kpis || !totals) {
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
  const visibleOps = operators
    .map((name, i) => ({ name, i }))
    .filter((o) => (opQuery ? o.name.includes(opQuery) : true))
    .slice(0, 60);

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
            {num(kpis.chargers)}
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

        {kpis.chargers === 0 ? (
          <div className={s.empty}>
            <h2 className={s.panelTitle}>조건에 맞는 충전기가 0기입니다</h2>
            <p className={s.kpiNote}>
              현재 걸린 조건: {chips.map((c) => c.label).join(" · ")}. 아래에서 한 번에 해제할 수 있습니다.
            </p>
            <button type="button" className={s.quickBtn} onClick={() => setF(EMPTY_FILTERS)}>
              모든 필터 해제
            </button>
          </div>
        ) : (
          <>
            <section className={s.kpis} aria-label="핵심 지표">
              <div className={s.kpi}>
                <div className={s.kpiLabel}>충전소</div>
                <div className={s.kpiValue}>
                  {num(kpis.stations)}
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
                  {num(kpis.chargers)}
                  <span className={s.kpiUnit}>기</span>
                </div>
                <p className={s.kpiNote}>커넥터 단위. 전국 {num(meta.total_chargers)}기 중.</p>
              </div>
              <div className={s.kpi}>
                <div className={s.kpiLabel}>급속 비율 (M3)</div>
                <div className={s.kpiValue}>{pct(kpis.fastRatio)}</div>
                <p className={s.kpiNote}>50kW 이상 또는 급속 커넥터 타입.</p>
              </div>
              <div className={s.kpi}>
                <div className={s.kpiLabel}>유휴율 (M5)</div>
                <div className={s.kpiValue}>{pct(kpis.idleRatio)}</div>
                <p className={s.kpiNote}>
                  분모는 <b>충전대기 + 충전중</b> 뿐입니다. 통신이상·점검중은 제외되므로
                  &lsquo;가용률&rsquo;이 아닙니다.
                </p>
              </div>
            </section>

            <div className={s.split}>
              <section className={s.panel} aria-label="충전기 분포">
                <div className={s.panelHead}>
                  <h2 className={s.panelTitle}>충전기 분포</h2>
                  <span className={s.badge}>2km 격자</span>
                  <div className={s.toggle} role="group" aria-label="지도 표시 방식">
                    {(["grid", "heat"] as MapView[]).map((v) => (
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
                        {v === "grid" ? "격자" : "히트맵"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={s.map}>
                  <DistributionMap cells={cells} view={view} gridDeg={meta.grid_deg} />
                </div>
                <p className={s.caveat}>
                  지도는 셀 {num(cells.length)}개로 집계된 값입니다. 좌표가 무효한 충전기{" "}
                  {num(meta.invalid_coord_chargers)}기는 <b>지도에서만 빠지고</b> 위 집계에는 포함됩니다.
                </p>
              </section>

              <section className={s.panel} aria-label="취약 지역 순위">
                <div className={s.panelHead}>
                  <h2 className={s.panelTitle}>
                    {opFiltered ? "선택 운영기관 공급 현황" : "충전 인프라 부족 지역"}
                  </h2>
                  <span className={s.badge}>{meta.population_label ?? "시군구"} · M2</span>
                </div>
                <div className={s.chart}>
                  <RankingChart rows={ranking} unit="기/인구10만" />
                </div>

                <div className={s.tableWrap}>
                  <table>
                    <caption>
                      인구 10만명당 충전기 수(M2). <b>낮을수록 접근성이 취약</b>합니다. 오름차순 상위{" "}
                      {RANK_SIZE}곳.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">지역</th>
                        <th scope="col">M2 (기/인구10만)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((r) => (
                        <tr key={r.name}>
                          <th scope="row" style={{ fontWeight: 400 }}>
                            {r.name}
                          </th>
                          <td className={s.num}>
                            {r.absent ? (
                              <span className={s.absent}>미진출</span>
                            ) : (
                              (r.value ?? 0).toFixed(1)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className={s.caveat}>
                  {opFiltered
                    ? "‘미진출’은 선택한 운영기관의 충전기가 0기라는 뜻입니다. 국가 인프라 부족과 다릅니다."
                    : "M1(EV 1,000대당)은 시도 단위, M2는 시군구 단위입니다. 해상도가 달라 직접 비교하지 않습니다."}
                </p>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
