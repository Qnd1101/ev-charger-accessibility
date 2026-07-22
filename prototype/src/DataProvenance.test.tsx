import { fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import DataProvenance, { parseDataSources, parseProvenanceOverview } from "./DataProvenance";

describe("DataProvenance", () => {
  it("문서의 세 출처와 확인된 이용 조건을 그대로 노출한다", () => {
    render(<DataProvenance />);
    fireEvent.click(screen.getByText("데이터 출처와 이용 조건"));

    expect(screen.getByRole("link", { name: /한국환경공단 전기자동차 충전소 정보/ })).toHaveAttribute(
      "href",
      "https://www.data.go.kr/data/15076352/openapi.do",
    );
    expect(screen.getByText(/공공누리 제1유형 \(출처표시\)/)).toBeInTheDocument();
    expect(screen.getByText(/전기차 기준·인구 기준·급속\s*비율·충전소 밀도·현재 비어 있음의 분자는 모두 이 데이터에서 나온다/)).toBeInTheDocument();
    expect(screen.getByText(/전기차 기준\(M1, 충전기\/EV 1,000대\)의 분모다/)).toBeInTheDocument();
    const mois = screen.getByRole("link", { name: /행정안전부 주민등록 인구통계/ }).closest("li");
    expect(mois).not.toBeNull();
    expect(within(mois!).queryByText("이용 조건")).not.toBeInTheDocument();
    expect(within(mois!).queryByText(/확인되지 않음|제1유형|기준일|제공/)).not.toBeInTheDocument();
    expect(screen.getByText(/대한민국 공공데이터를 결합해 전기차 충전 인프라의 지리적 분포와 수요 대비 공급 격차를 살펴보는 대학 과제용 분석 대시보드/)).toBeInTheDocument();
    expect(screen.getByText(/배경지도 타일\(CARTO Positron\)은 데이터 출처가 아니라 외부 통신 경계다/)).toBeInTheDocument();
  });

  it("접힌 패널의 기본 마크업에 axe 위반이 없다", async () => {
    const { container } = render(<DataProvenance />);
    // jsdom에는 canvas 렌더링이 없어 색 대비는 브라우저 e2e에서 검증한다.
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });

  it("출처 문서 구조가 바뀌면 누락을 드러낸다", () => {
    expect(parseDataSources("# 빈 문서")).toHaveLength(0);
    expect(parseProvenanceOverview("# 빈 문서")).toEqual({ projectPurpose: "", networkBoundary: "" });
  });
});
