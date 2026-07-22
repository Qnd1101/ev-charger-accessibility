/** Python exporter가 만든 정적 JSON을 React 데이터셋으로 바꾸는 런타임 계약 경계. */

import type { Dataset } from "./data";

export const SUPPORTED_SCHEMA_VERSION = 1;

export interface DatasetFiles {
  meta: unknown;
  metrics: unknown;
  operators: unknown;
  regions: unknown;
  regionCube: unknown;
  statusCube: unknown;
  gridCube: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function contractError(file: string, detail: string): never {
  throw new Error(
    `집계 파일 ${file}의 데이터 계약이 올바르지 않습니다: ${detail}. ` +
      "`python scripts/build_web_data.py` 로 다시 생성하세요.",
  );
}

function validateSchemaVersion(meta: unknown): void {
  const actual = isRecord(meta) ? meta.schema_version : undefined;
  if (actual === SUPPORTED_SCHEMA_VERSION) return;

  contractError(
    "meta.json",
    `schema_version이 잘못되었습니다 (기대: ${SUPPORTED_SCHEMA_VERSION}, 실제: ${actual === undefined ? "없음" : String(actual)}). ` +
      "앱과 데이터가 서로 다른 스키마 버전으로 만들어졌습니다",
  );
}

function actualType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

const actualTypeOrMissing = (value: unknown): string => (value === undefined ? "없음" : actualType(value));

function requirePrimitive(
  file: string,
  record: Record<string, unknown>,
  key: string,
  expected: "string" | "number" | "boolean",
): void {
  if (typeof record[key] !== expected) {
    contractError(
      file,
      `${key}가 잘못되었습니다 (기대: ${expected}, 실제: ${actualTypeOrMissing(record[key])})`,
    );
  }
}

function requireNullableString(file: string, record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (value !== null && typeof value !== "string") {
    contractError(
      file,
      `${key}가 잘못되었습니다 (기대: string|null, 실제: ${actualTypeOrMissing(value)})`,
    );
  }
}

function requireStringArray(file: string, record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (!Array.isArray(value)) {
    contractError(file, `${key}가 잘못되었습니다 (기대: string[], 실제: ${actualTypeOrMissing(value)})`);
  }
  value.forEach((element, elementIndex) => {
    if (typeof element !== "string") {
      contractError(
        file,
        `${key}의 ${elementIndex}번 요소가 잘못되었습니다 (기대: string, 실제: ${actualType(element)})`,
      );
    }
  });
}

function validateMeta(value: unknown): void {
  const file = "meta.json";
  if (!isRecord(value)) {
    contractError(file, `최상위 값이 잘못되었습니다 (기대: object, 실제: ${actualType(value)})`);
  }
  validateSchemaVersion(value);
  requirePrimitive(file, value, "snapshot_date", "string");
  requirePrimitive(file, value, "ev_date", "string");
  requireNullableString(file, value, "population_date");
  requireNullableString(file, value, "population_label");
  requirePrimitive(file, value, "total_chargers", "number");
  requirePrimitive(file, value, "grid_deg", "number");
  requireStringArray(file, value, "top_operators");
  requirePrimitive(file, value, "station_overcount_max", "number");
  requirePrimitive(file, value, "invalid_coord_chargers", "number");
}

function validateTupleRows(file: string, value: unknown, width: number): void {
  if (!Array.isArray(value)) {
    contractError(file, `최상위 값이 잘못되었습니다 (기대: array, 실제: ${actualType(value)})`);
  }

  value.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      contractError(file, `${rowIndex}번 행이 잘못되었습니다 (기대: array, 실제: ${actualType(row)})`);
    }
    if (row.length !== width) {
      contractError(file, `${rowIndex}번 행의 길이가 잘못되었습니다 (기대: 길이 ${width}, 실제: 길이 ${row.length})`);
    }
    row.forEach((element, elementIndex) => {
      if (typeof element !== "number") {
        contractError(
          file,
          `${rowIndex}번 행의 ${elementIndex}번 요소가 잘못되었습니다 ` +
            `(기대: number, 실제: ${actualType(element)})`,
        );
      }
    });
  });
}

function validateStatusCube(value: unknown): void {
  const file = "status_cube.json";
  if (!isRecord(value)) {
    contractError(file, `최상위 값이 잘못되었습니다 (기대: object, 실제: ${actualType(value)})`);
  }
  if (!Array.isArray(value.labels)) {
    contractError(file, `labels가 잘못되었습니다 (기대: string[], 실제: ${actualType(value.labels)})`);
  }
  value.labels.forEach((label, labelIndex) => {
    if (typeof label !== "string") {
      contractError(
        file,
        `labels의 ${labelIndex}번 요소가 잘못되었습니다 (기대: string, 실제: ${actualType(label)})`,
      );
    }
  });
  validateTupleRows(file, value.rows, 4 + value.labels.length);
}

function validateMetrics(value: unknown): void {
  const file = "metrics.json";
  if (!Array.isArray(value)) {
    contractError(file, `최상위 값이 잘못되었습니다 (기대: array, 실제: ${actualType(value)})`);
  }

  value.forEach((metric, metricIndex) => {
    if (!isRecord(metric)) {
      contractError(file, `${metricIndex}번 항목이 잘못되었습니다 (기대: object, 실제: ${actualType(metric)})`);
    }

    const requireMetricPrimitive = (key: string, expected: "string" | "number" | "boolean") => {
      if (typeof metric[key] !== expected) {
        contractError(
          file,
          `${metricIndex}번 항목의 ${key}가 잘못되었습니다 ` +
            `(기대: ${expected}, 실제: ${actualTypeOrMissing(metric[key])})`,
        );
      }
    };

    requireMetricPrimitive("id", "string");
    requireMetricPrimitive("label", "string");
    requireMetricPrimitive("unit", "string");
    requireMetricPrimitive("isRatio", "boolean");
    requireMetricPrimitive("polarity", "string");
    requireMetricPrimitive("decimals", "number");
    requireMetricPrimitive("resolution", "string");
    requireMetricPrimitive("definition", "string");
    requireNullableString(file, metric, "caveat");

    for (const termName of ["numerator", "denominator"] as const) {
      const term = metric[termName];
      if (!isRecord(term)) {
        contractError(
          file,
          `${metricIndex}번 항목의 ${termName}가 잘못되었습니다 ` +
            `(기대: object, 실제: ${actualTypeOrMissing(term)})`,
        );
      }
      for (const [key, expected] of [["field", "string"], ["scale", "number"]] as const) {
        if (typeof term[key] !== expected) {
          contractError(
            file,
            `${metricIndex}번 항목의 ${termName}.${key}가 잘못되었습니다 ` +
              `(기대: ${expected}, 실제: ${actualTypeOrMissing(term[key])})`,
          );
        }
      }
    }
  });
}

function validateObjectArray(
  file: string,
  arrayName: string,
  value: unknown,
  fields: readonly (readonly [string, "string" | "number"])[],
): void {
  if (!Array.isArray(value)) {
    contractError(file, `${arrayName}가 잘못되었습니다 (기대: array, 실제: ${actualTypeOrMissing(value)})`);
  }
  value.forEach((entry, entryIndex) => {
    if (!isRecord(entry)) {
      contractError(
        file,
        `${arrayName}[${entryIndex}]가 잘못되었습니다 (기대: object, 실제: ${actualType(entry)})`,
      );
    }
    for (const [key, expected] of fields) {
      if (typeof entry[key] !== expected) {
        contractError(
          file,
          `${arrayName}[${entryIndex}].${key}가 잘못되었습니다 ` +
            `(기대: ${expected}, 실제: ${actualTypeOrMissing(entry[key])})`,
        );
      }
    }
    if (entry.population !== null && typeof entry.population !== "number") {
      contractError(
        file,
        `${arrayName}[${entryIndex}].population이 잘못되었습니다 ` +
          `(기대: number|null, 실제: ${actualTypeOrMissing(entry.population)})`,
      );
    }
  });
}

function validateRegions(value: unknown): { regions: Dataset["regions"]; sidos: Dataset["sidos"] } {
  const file = "regions.json";
  if (!isRecord(value)) {
    contractError(file, `최상위 값이 잘못되었습니다 (기대: object, 실제: ${actualType(value)})`);
  }
  validateObjectArray(file, "regions", value.regions, [
    ["zscode", "number"],
    ["zcode", "number"],
    ["sido", "string"],
    ["sigungu", "string"],
  ]);
  validateObjectArray(file, "sidos", value.sidos, [
    ["zcode", "number"],
    ["name", "string"],
    ["ev_count", "number"],
  ]);
  return value as { regions: Dataset["regions"]; sidos: Dataset["sidos"] };
}

function validateOperators(value: unknown): void {
  const file = "operators.json";
  if (!Array.isArray(value)) {
    contractError(file, `최상위 값이 잘못되었습니다 (기대: string[], 실제: ${actualType(value)})`);
  }
  value.forEach((operator, operatorIndex) => {
    if (typeof operator !== "string") {
      contractError(
        file,
        `${operatorIndex}번 요소가 잘못되었습니다 (기대: string, 실제: ${actualType(operator)})`,
      );
    }
  });
}

export function validateDatasetFiles(files: DatasetFiles): Dataset {
  validateMeta(files.meta);
  validateMetrics(files.metrics);
  validateOperators(files.operators);
  validateTupleRows("region_cube.json", files.regionCube, 9);
  validateTupleRows("grid_cube.json", files.gridCube, 7);
  validateStatusCube(files.statusCube);
  const regionsFile = validateRegions(files.regions);
  return {
    meta: files.meta as Dataset["meta"],
    metrics: files.metrics as Dataset["metrics"],
    operators: files.operators as Dataset["operators"],
    regions: regionsFile.regions,
    sidos: regionsFile.sidos,
    regionCube: files.regionCube as Dataset["regionCube"],
    statusCube: files.statusCube as Dataset["statusCube"],
    gridCube: files.gridCube as Dataset["gridCube"],
  };
}
