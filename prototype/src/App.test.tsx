import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "./data";
import type { MetricSpec } from "./metrics";

const { distributionMapMock, loadDatasetMock } = vi.hoisted(() => ({
  distributionMapMock: vi.fn(),
  loadDatasetMock: vi.fn(),
}));

vi.mock("./data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data")>()),
  loadDataset: loadDatasetMock,
}));

vi.mock("./DistributionMap", () => ({
  default: (props: unknown) => {
    distributionMapMock(props);
    return (
      <section aria-label="지도 대체 콘텐츠">
        <button type="button">3D 취약도</button>
      </section>
    );
  },
}));
vi.mock("./RankingChart", () => ({ default: () => <figure aria-label="차트 대체 콘텐츠" /> }));

import App from "./App";

const metric = (
  id: string,
  numerator: MetricSpec["numerator"]["field"],
  denominator: MetricSpec["denominator"]["field"],
): MetricSpec => ({
  id,
  label: id,
  unit: "단위",
  isRatio: true,
  numerator: { field: numerator, scale: 1 },
  denominator: { field: denominator, scale: 1 },
  decimals: 1,
  polarity: "low_is_vulnerable",
  resolution: "sigungu",
  definition: `${id} 정의`,
  caveat: null,
});

const dataset: Dataset = {
  meta: {
    snapshot_date: "2026-07-12",
    ev_date: "2025-12-31",
    population_date: "2026-06",
    population_label: "시군구",
    total_chargers: 10,
    invalid_coord_chargers: 1,
    grid_deg: 0.02,
    top_operators: ["기관 A"],
    station_overcount_max: 0,
  },
  metrics: [
    {
      ...metric("M1", "charger_count", "ev_count"),
      resolution: "sido",
      unit: "기/EV1000대",
      isRatio: false,
      denominator: { field: "ev_count", scale: 1000 },
    },
    metric("M2", "charger_count", "population"),
    metric("M3", "fast_count", "charger_count"),
    metric("M5", "available_count", "live_count"),
  ],
  operators: ["기관 A", "기관 B", "기관 C"],
  regions: [
    { zscode: 11010, zcode: 11, sido: "서울특별시", sigungu: "종로구", population: 1000 },
    { zscode: 11020, zcode: 11, sido: "서울특별시", sigungu: "강남구", population: 2000 },
  ],
  sidos: [{ zcode: 11, name: "서울특별시", ev_count: 100, population: null }],
  regionCube: [
    [11010, 0, 0, 0, 9, 5, 4, 8, 3],
    [11010, 1, 0, 0, 1, 1, 0, 1, 1],
  ],
  // regionCube 와 같은 키의 상태별 분해: op0(충전기9,응답8,사용가능3) -> 충전대기3+충전중5+미확인1,
  // op1(충전기1,응답1,사용가능1) -> 충전대기1.
  statusCube: {
    labels: ["충전대기", "충전중", "상태미확인"],
    rows: [
      [11010, 0, 0, 0, 3, 5, 1],
      [11010, 1, 0, 0, 1, 0, 0],
    ],
  },
  gridCube: [
    [37500, 127000, 11, 0, 0, 1, 9],
    [37500, 127000, 11, 1, 0, 1, 1],
  ],
};

describe("App 빈 결과 상태", () => {
  beforeEach(() => {
    loadDatasetMock.mockReset();
    loadDatasetMock.mockResolvedValue(dataset);
    distributionMapMock.mockReset();
  });

  it("시군구 코로플레스를 기본 지도 표현으로 연결한다", async () => {
    render(<App />);

    expect(await screen.findByText("시군구 코로플레스")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "코로플레스" })).toHaveAttribute("aria-pressed", "true");
    expect(distributionMapMock).toHaveBeenCalledWith(expect.objectContaining({ view: "region" }));
  });

  it("지역별 충전기 수 보기에서 많이 분포한 시군구 목록을 보여준다", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "지역별 충전기 수" }));

    expect(screen.getByRole("region", { name: "충전기가 많이 분포한 지역" })).toHaveTextContent("서울 종로구");
    expect(distributionMapMock).toHaveBeenLastCalledWith(expect.objectContaining({ view: "supply" }));
  });

  it("충전기 상태 분포 표가 statusCube 를 상태별로 합산하고 '충전기' KPI와 합계가 일치한다", async () => {
    render(<App />);

    await screen.findByRole("region", { name: "충전기 상태 분포" });

    expect(await screen.findByRole("row", { name: "충전대기 4" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "충전중 5" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "상태미확인 1" })).toBeInTheDocument();
    // 합계(4+5+1=10)는 위 '충전기' KPI(9+1=10)와 일치해야 한다(같은 큐브 키에서 나온 값).
    expect(screen.getAllByText("10").length).toBeGreaterThan(0);
  });

  it("결과를 0건으로 만든 필터를 밝히고 한 번에 복구한다", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /기관 C/ }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("선택 운영기관: 기관 C");
    expect(status).toHaveTextContent("운영기관: 이 조건만 완화하면 결과가 복구됩니다.");
    expect(status).toHaveTextContent("현재 0건은 단일 조건에서 발생했습니다.");

    await user.click(screen.getByRole("button", { name: "운영기관 조건 해제" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getAllByText("10").length).toBeGreaterThan(0);
  });

  it("단일 차원 완화로 복구되지 않는 조합 원인을 구분한다", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /기관 C/ }));
    await user.click(screen.getByRole("radio", { name: "완속만" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("운영기관: 이 조건만 완화해도 0기입니다.");
    expect(status).toHaveTextContent("충전 속도: 이 조건만 완화해도 0기입니다.");
    expect(status).toHaveTextContent("단일 조건 완화만으로 복구되지 않는 조합 원인");
  });

  it("희소 큐브에 행이 없는 지역을 선택 운영기관의 미진출로 표시한다", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("checkbox", { name: /기관 B/ }));

    expect(await screen.findByRole("row", { name: /서울 강남구 미진출/ })).toBeInTheDocument();
    expect(screen.getAllByText("미진출")).toHaveLength(1);
  });

  it("실패 파일명과 재생성 경로를 보존하고 다시 시도한다", async () => {
    loadDatasetMock
      .mockReset()
      .mockRejectedValueOnce(new Error("집계 파일 meta.json 을 읽지 못했습니다 (HTTP 404)."))
      .mockResolvedValueOnce(dataset);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText(/meta\.json.*HTTP 404/)).toBeInTheDocument();
    expect(screen.getByText(/python scripts\/build_web_data\.py/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "데이터 다시 불러오기" }));
    expect(await screen.findByRole("heading", { name: "대한민국 충전 인프라 관제" })).toBeInTheDocument();
  });

  it("비교 기준 토글: 전기차 기준을 선택하면 시도 해상도로 바뀐다", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("시군구 기준 · 인구 10만 명당")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /전기차 기준/ }));

    expect(await screen.findByText("시도 기준 · 전기차 1,000대당")).toBeInTheDocument();
    // 서울특별시 시도 합계 충전기 10기(9+1), EV 등록 100대 -> 10 / (100/1000) = 100.0.
    expect(screen.getByRole("row", { name: /서울특별시.*100\.0/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /인구 기준/ }));
    expect(await screen.findByText("시군구 기준 · 인구 10만 명당")).toBeInTheDocument();
  });

  it("로드 성공 전체 화면에 색 대비 외 axe 위반이 없다", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "대한민국 충전 인프라 관제" });
    await userEvent.setup().click(screen.getByText("데이터 출처와 이용 조건"));

    // jsdom은 실제 CSS 색을 계산할 canvas가 없어 대비는 브라우저 e2e 범위로 남긴다.
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
