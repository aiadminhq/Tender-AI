import type { ReactNode } from "react";
import { useState } from "react";
import { BarChart3, Check, Copy, Share2, Star, Table2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  AssistantActionArtifact,
  AssistantArtifact,
  AssistantArtifactCell,
  AssistantChartArtifact,
  AssistantTableArtifact,
  AssistantTableArtifactColumn,
} from "./assistant-artifact-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { postSave, postShare } from "@/lib/api";

function formatCell(value: AssistantArtifactCell): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function alignClass(align: AssistantTableArtifactColumn["align"]): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

function ArtifactHeader({
  title,
  caption,
  icon,
  tone,
}: {
  title?: string | null;
  caption?: string | null;
  icon: ReactNode;
  tone: string;
}) {
  if (!title && !caption) return null;

  return (
    <header className="flex items-start gap-2 border-b border-border bg-slate-50 px-3 py-2.5">
      <span
        className={cn(
          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md",
          tone,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        {title && (
          <h3 className="text-[12px] font-semibold leading-tight text-foreground">
            {title}
          </h3>
        )}
        {caption && (
          <p className="mt-0.5 text-[10px] leading-relaxed text-ink-dim">
            {caption}
          </p>
        )}
      </div>
    </header>
  );
}

function TableArtifact({ artifact }: { artifact: AssistantTableArtifact }) {
  if (artifact.columns.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_10px_24px_-24px_rgba(15,23,42,.45)]">
      <ArtifactHeader
        title={artifact.title}
        caption={artifact.caption}
        icon={<Table2 size={13} />}
        tone="bg-sky-50 text-sky-700"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[12px]">
          <thead className="bg-white text-foreground">
            <tr>
              {artifact.columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    "border-b border-border px-3 py-2 font-semibold",
                    alignClass(column.align),
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-white even:bg-slate-50/60">
                {artifact.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "border-b border-border/60 px-3 py-2 align-top text-foreground/90 last:border-b-0",
                      alignClass(column.align),
                    )}
                  >
                    {formatCell(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function chartConfig(artifact: AssistantChartArtifact): ChartConfig {
  return Object.fromEntries(
    artifact.series.map((series, index) => [
      series.key,
      {
        label: series.label,
        color: series.color ?? `var(--chart-${(index % 5) + 1})`,
      },
    ]),
  );
}

function chartHeight(artifact: AssistantChartArtifact): number {
  const value = artifact.height ?? 220;
  return Math.min(Math.max(value, 160), 360);
}

function ChartBody({ artifact }: { artifact: AssistantChartArtifact }) {
  const config = chartConfig(artifact);
  const height = chartHeight(artifact);
  const series = artifact.series.filter((item) => item.key.trim());
  if (series.length === 0 || artifact.rows.length === 0) return null;

  if (artifact.chartType === "line") {
    return (
      <ChartContainer
        config={config}
        className="w-full"
        style={{ height }}
        initialDimension={{ width: 360, height }}
      >
        <LineChart accessibilityLayer data={artifact.rows} margin={{ left: -8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={artifact.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={34} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              stroke={`var(--color-${item.key})`}
              strokeWidth={2}
              dot={{ r: 2.5 }}
            />
          ))}
        </LineChart>
      </ChartContainer>
    );
  }

  if (artifact.chartType === "pie") {
    const valueKey = series[0].key;
    return (
      <ChartContainer
        config={config}
        className="w-full"
        style={{ height }}
        initialDimension={{ width: 360, height }}
      >
        <PieChart accessibilityLayer>
          <ChartTooltip
            content={<ChartTooltipContent nameKey={artifact.xKey} hideLabel />}
          />
          <Pie
            data={artifact.rows}
            dataKey={valueKey}
            nameKey={artifact.xKey}
            innerRadius={52}
            outerRadius={84}
            paddingAngle={2}
          >
            {artifact.rows.map((_, index) => (
              <Cell
                key={index}
                fill={`var(--chart-${(index % 5) + 1})`}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer
      config={config}
      className="w-full"
      style={{ height }}
      initialDimension={{ width: 360, height }}
    >
      <BarChart accessibilityLayer data={artifact.rows} margin={{ left: -8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey={artifact.xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={34} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.map((item) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            fill={`var(--color-${item.key})`}
            radius={artifact.stacked ? 0 : 6}
            stackId={artifact.stacked ? "assistant-artifact" : undefined}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function ChartLegend({ artifact }: { artifact: AssistantChartArtifact }) {
  if (artifact.series.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-3 text-[10px] text-ink-dim">
      {artifact.series.map((series, index) => (
        <span key={series.key} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-sm"
            style={{
              background: series.color ?? `var(--chart-${(index % 5) + 1})`,
            }}
          />
          {series.label}
        </span>
      ))}
    </div>
  );
}

function ChartArtifact({ artifact }: { artifact: AssistantChartArtifact }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_10px_24px_-24px_rgba(15,23,42,.45)]">
      <ArtifactHeader
        title={artifact.title}
        caption={artifact.caption}
        icon={<BarChart3 size={13} />}
        tone="bg-emerald-50 text-emerald-700"
      />
      <div className="px-2 py-3">
        <ChartBody artifact={artifact} />
      </div>
      <ChartLegend artifact={artifact} />
    </section>
  );
}

function artifactShareText(artifact: AssistantActionArtifact): string {
  const payload = artifact.payload
    ? `\n\n${JSON.stringify(artifact.payload, null, 2)}`
    : "";
  return [artifact.title, artifact.caption].filter(Boolean).join("\n") + payload;
}

function ActionArtifact({ artifact }: { artifact: AssistantActionArtifact }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const tenderIds = artifact.tenderIds ?? [];
  const shareText = artifactShareText(artifact);

  const copy = async () => {
    await navigator.clipboard?.writeText(shareText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const saveTenders = () => {
    for (const id of tenderIds) postSave(String(id), true);
    setSaved(true);
  };

  const share = async () => {
    for (const id of tenderIds) postShare(String(id), "link");
    if (navigator.share) {
      await navigator.share({
        title: artifact.title ?? "Tender AI artifact",
        text: shareText,
      });
      return;
    }
    await copy();
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_10px_24px_-24px_rgba(15,23,42,.45)]">
      <ArtifactHeader
        title={artifact.title}
        caption={artifact.caption}
        icon={<Share2 size={13} />}
        tone="bg-amber-50 text-amber-700"
      />
      <div className="flex flex-wrap gap-2 px-3 py-3">
        {artifact.actions.includes("save") && (
          <Button
            type="button"
            size="sm"
            variant={saved ? "primary" : "outline"}
            onClick={saveTenders}
            disabled={tenderIds.length === 0}
          >
            {saved ? <Check size={13} /> : <Star size={13} />}
            {saved ? "已收藏" : "收藏標案"}
          </Button>
        )}
        {artifact.actions.includes("share") && (
          <Button type="button" size="sm" variant="outline" onClick={share}>
            <Share2 size={13} />
            分享
          </Button>
        )}
        {artifact.actions.includes("copy") && (
          <Button type="button" size="sm" variant="ghost" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "已複製" : "複製"}
          </Button>
        )}
      </div>
    </section>
  );
}

export function AssistantArtifacts({
  artifacts,
}: {
  artifacts: AssistantArtifact[];
}) {
  if (artifacts.length === 0) return null;

  return (
    <div className="space-y-2">
      {artifacts.map((artifact) =>
        artifact.type === "table" ? (
          <TableArtifact key={artifact.id} artifact={artifact} />
        ) : artifact.type === "chart" ? (
          <ChartArtifact key={artifact.id} artifact={artifact} />
        ) : artifact.type === "actions" ? (
          <ActionArtifact key={artifact.id} artifact={artifact} />
        ) : null,
      )}
    </div>
  );
}
