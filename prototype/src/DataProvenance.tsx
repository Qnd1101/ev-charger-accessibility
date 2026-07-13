import sourceDocument from "../../docs/data-sources.md?raw";

import s from "./DataProvenance.module.css";

interface SourceRecord {
  title: string;
  href: string;
  provider: string | null;
  license: string | null;
  basisDate: string | null;
  purpose: string | null;
}

interface ProvenanceOverview {
  projectPurpose: string;
  networkBoundary: string;
}

const plain = (value: string) =>
  value
    .replace(/\*\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

function field(section: string, label: string): string {
  return plain(section.match(new RegExp(`^- ${label}: (.+)$`, "m"))?.[1] ?? "확인되지 않음");
}

function licenseField(section: string): string {
  return plain(
    section.match(/^- \*\*이용허락범위:\s*([\s\S]*?)(?=\n- |\n\n|$)/m)?.[1] ??
      "확인되지 않음",
  );
}

function basisDate(section: string): string {
  const explicit = section.match(/기준(?:일|월)\s+(\d{4}-\d{2}(?:-\d{2})?)/)?.[1];
  if (explicit) return explicit;

  const snapshot = section.match(/chargers_(\d{4})(\d{2})(\d{2})/);
  return snapshot ? `${snapshot[1]}-${snapshot[2]}-${snapshot[3]}` : "확인되지 않음";
}

/** 패널 소개와 외부 통신 경계도 같은 문서에서 읽어 UI 리터럴이 갈라지지 않게 한다. */
export function parseProvenanceOverview(markdown: string): ProvenanceOverview {
  const projectPurpose = plain(
    markdown.match(/^- 프로젝트 목적: (.+)$/m)?.[1] ?? "",
  );
  const networkBoundary = plain(
    markdown.match(/^- 배경지도 타일\(CARTO Positron\)[\s\S]*?(?=\n\n|$)/m)?.[0].replace(/^- /, "") ?? "",
  );
  return { projectPurpose, networkBoundary };
}

/** 화면의 출처 문구는 docs/data-sources.md에서만 읽는다. */
export function parseDataSources(markdown: string): SourceRecord[] {
  return markdown
    .split(/^## (?=\d+\. )/m)
    .slice(1, 4)
    .map((section) => {
      const title = plain(section.match(/^\d+\. (.+)$/m)?.[1] ?? "데이터 출처");
      const purpose = plain(
        section.match(/\*\*무엇에 쓰는가:\*\*\s*([\s\S]*?)(?=\n\n|$)/)?.[1] ??
          "화면 집계의 근거 데이터입니다.",
      );
      const linkOnly = title.startsWith("행정안전부 주민등록 인구통계");

      return {
        title,
        href: section.match(/^- 링크: (https?:\/\/\S+)/m)?.[1] ?? "#",
        provider: linkOnly ? null : field(section, "제공기관"),
        license: linkOnly ? null : licenseField(section),
        basisDate: linkOnly ? null : basisDate(section),
        purpose: linkOnly ? null : purpose,
      };
    });
}

const sources = parseDataSources(sourceDocument);
const overview = parseProvenanceOverview(sourceDocument);

export default function DataProvenance() {
  return (
    <details className={s.panel}>
      <summary className={s.summary}>데이터 출처와 이용 조건</summary>
      <p className={s.intro}>{overview.projectPurpose}</p>
      <ul className={s.list}>
        {sources.map((source) => (
          <li key={source.title} className={s.source}>
            <a href={source.href} target="_blank" rel="noreferrer" className={s.link}>
              {source.title}
              <span className={s.external} aria-hidden="true">↗</span>
            </a>
            {source.license && (
              <>
                <dl className={s.meta}>
                  <div>
                    <dt>제공</dt>
                    <dd>{source.provider}</dd>
                  </div>
                  <div>
                    <dt>기준일</dt>
                    <dd>{source.basisDate}</dd>
                  </div>
                  <div>
                    <dt>이용 조건</dt>
                    <dd>{source.license}</dd>
                  </div>
                </dl>
                <p className={s.purpose}>{source.purpose}</p>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className={s.network}>{overview.networkBoundary}</p>
    </details>
  );
}
