import type {
  AssistantActionArtifact,
  AssistantArtifact,
  AssistantArtifactCell,
  AssistantChartArtifact,
  AssistantChartArtifactSeries,
  AssistantChartValue,
  AssistantTableArtifact,
  AssistantTableArtifactColumn,
} from "./assistant-artifact-types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idValue(value: unknown, fallback: string): string {
  return stringValue(value) ?? fallback;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
  return ids.length ? ids : undefined;
}

function artifactCell(value: unknown): AssistantArtifactCell {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return String(value ?? "");
}

function chartValue(value: unknown): AssistantChartValue {
  if (typeof value === "string" || typeof value === "number" || value === null) {
    return value;
  }
  return String(value ?? "");
}

function rowRecords(
  value: unknown,
  coerce: (value: unknown) => AssistantArtifactCell | AssistantChartValue,
): Record<string, AssistantArtifactCell | AssistantChartValue>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, cell]) => [key, coerce(cell)]),
    ),
  );
}

function tableColumns(value: unknown): AssistantTableArtifactColumn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ key: item.trim(), label: item.trim() }];
    }
    if (!isRecord(item)) return [];
    const key = stringValue(item.key) ?? stringValue(item.id);
    if (!key) return [];
    const align = stringValue(item.align);
    return [
      {
        key,
        label: stringValue(item.label) ?? key,
        ...(align === "left" || align === "right" || align === "center"
          ? { align }
          : {}),
      },
    ];
  });
}

function chartSeries(value: unknown): AssistantChartArtifactSeries[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ key: item.trim(), label: item.trim() }];
    }
    if (!isRecord(item)) return [];
    const key = stringValue(item.key) ?? stringValue(item.id);
    if (!key) return [];
    return [
      {
        key,
        label: stringValue(item.label) ?? key,
        ...(stringValue(item.color) ? { color: stringValue(item.color)! } : {}),
      },
    ];
  });
}

function actionList(value: unknown): AssistantActionArtifact["actions"] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["save", "share", "copy"]);
  return value.filter(
    (item): item is "save" | "share" | "copy" =>
      typeof item === "string" && allowed.has(item),
  );
}

function normalizeTableArtifact(input: UnknownRecord): AssistantTableArtifact | null {
  const columns = tableColumns(input.columns);
  const rows = rowRecords(input.rows ?? input.data, artifactCell) as Record<
    string,
    AssistantArtifactCell
  >[];
  if (columns.length === 0 || rows.length === 0) return null;
  return {
    type: "table",
    id: idValue(input.id ?? input.artifact_id, "table-artifact"),
    title: textOrNull(input.title),
    caption: textOrNull(input.caption ?? input.description),
    columns,
    rows,
  };
}

function normalizeChartArtifact(input: UnknownRecord): AssistantChartArtifact | null {
  const rawType = stringValue(input.chartType ?? input.chart_type ?? input.subtype);
  const chartType =
    rawType === "line" || rawType === "pie" || rawType === "bar" ? rawType : "bar";
  const xKey = stringValue(input.xKey ?? input.x_key ?? input.labelKey);
  const series = chartSeries(input.series);
  const rows = rowRecords(input.rows ?? input.data, chartValue) as Record<
    string,
    AssistantChartValue
  >[];
  if (!xKey || series.length === 0 || rows.length === 0) return null;

  return {
    type: "chart",
    id: idValue(input.id ?? input.artifact_id, "chart-artifact"),
    title: textOrNull(input.title),
    caption: textOrNull(input.caption ?? input.description),
    chartType,
    xKey,
    series,
    rows,
    ...(typeof input.stacked === "boolean" ? { stacked: input.stacked } : {}),
    ...(typeof input.height === "number" ? { height: input.height } : {}),
  };
}

function normalizeActionArtifact(input: UnknownRecord): AssistantActionArtifact | null {
  const actions = actionList(input.actions ?? input.action_ids);
  if (actions.length === 0) return null;
  const payload = isRecord(input.payload ?? input.data)
    ? ((input.payload ?? input.data) as UnknownRecord)
    : undefined;

  return {
    type: "actions",
    id: idValue(input.id ?? input.artifact_id, "actions-artifact"),
    title: textOrNull(input.title),
    caption: textOrNull(input.caption ?? input.description),
    tenderIds: numberArray(input.tenderIds ?? input.tender_ids),
    payload,
    actions,
  };
}

export function adaptC1Artifact(input: unknown): AssistantArtifact | null {
  if (!isRecord(input)) return null;
  const rawKind = stringValue(input.type ?? input.kind);
  if (rawKind === "table") return normalizeTableArtifact(input);
  if (rawKind === "chart") return normalizeChartArtifact(input);
  if (rawKind === "actions" || rawKind === "action") {
    return normalizeActionArtifact(input);
  }
  return null;
}

export function adaptAssistantArtifact(input: unknown): AssistantArtifact | null {
  return adaptC1Artifact(input);
}
