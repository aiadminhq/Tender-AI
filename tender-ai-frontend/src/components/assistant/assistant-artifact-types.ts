export type AssistantArtifactCell = string | number | boolean | null;

export interface AssistantTableArtifactColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
}

export interface AssistantTableArtifact {
  type: "table";
  id: string;
  title?: string | null;
  caption?: string | null;
  columns: AssistantTableArtifactColumn[];
  rows: Record<string, AssistantArtifactCell>[];
}

export type AssistantChartValue = string | number | null;

export interface AssistantChartArtifactSeries {
  key: string;
  label: string;
  color?: string;
}

export interface AssistantChartArtifact {
  type: "chart";
  id: string;
  title?: string | null;
  caption?: string | null;
  chartType: "bar" | "line" | "pie";
  xKey: string;
  series: AssistantChartArtifactSeries[];
  rows: Record<string, AssistantChartValue>[];
  stacked?: boolean;
  height?: number;
}

export interface AssistantActionArtifact {
  type: "actions";
  id: string;
  title?: string | null;
  caption?: string | null;
  tenderIds?: number[];
  payload?: Record<string, unknown>;
  actions: Array<"save" | "share" | "copy">;
}

export type AssistantArtifact =
  | AssistantTableArtifact
  | AssistantChartArtifact
  | AssistantActionArtifact;
