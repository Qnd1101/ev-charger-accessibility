/** 취약 지역 랭킹 막대. 값은 표와 같은 배열에서 나온다 -- 교차 검증이 가능해야 한다. */
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface RankRow {
  name: string;
  value: number | null;
  absent: boolean;
}

interface Props {
  rows: RankRow[];
  unit: string;
}

export default function RankingChart({ rows, unit }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = echarts.init(box.current, undefined, { renderer: "canvas" });
    chart.current = c;
    const resize = () => c.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;

    // 위에서부터 취약한 순. 막대가 짧을수록 취약이라는 방향을 고정한다.
    const data = [...rows].reverse();
    c.setOption(
      {
        animationDuration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300,
        grid: { left: 96, right: 56, top: 8, bottom: 24 },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          valueFormatter: (v: number) => `${v.toFixed(1)} ${unit}`,
        },
        xAxis: { type: "value", axisLabel: { color: "#4e5968" }, splitLine: { lineStyle: { color: "#e5e8eb" } } },
        yAxis: {
          type: "category",
          data: data.map((r) => (r.absent ? `${r.name} (미진출)` : r.name)),
          axisLabel: { color: "#191f28", fontSize: 11 },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            data: data.map((r) => ({
              value: r.value ?? 0,
              // 미진출(선택 기관 0개)은 국가 인프라 부족과 다른 상태다. 색과 라벨을 분리한다.
              itemStyle: { color: r.absent ? "#e42939" : "#3182f6", borderRadius: [0, 6, 6, 0] },
            })),
            label: {
              show: true,
              position: "right",
              formatter: ({ dataIndex }: { dataIndex: number }) =>
                data[dataIndex].absent ? "미진출" : (data[dataIndex].value ?? 0).toFixed(1),
              color: "#4e5968",
              fontSize: 11,
            },
          },
        ],
      },
      { notMerge: true },
    );
  }, [rows, unit]);

  // ECharts 초기 크기 계산에 두 축의 명시적 크기가 필요해 단일 layout-critical 스타일은 인접해 둔다.
  return <div ref={box} style={{ width: "100%", height: "100%" }} role="img" aria-label="취약 지역 순위 막대 차트. 같은 값을 아래 표로도 제공합니다." />;
}
