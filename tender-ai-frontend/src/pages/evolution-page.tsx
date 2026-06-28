import { useCallback, useEffect, useState } from "react";
import {
  Brain,
  CircleCheck,
  CircleSlash,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  fetchEvolutionStatus,
  runEvolution,
  type EvolutionStatus,
  type EvoTermWeight,
} from "@/lib/api";

type Status = "loading" | "ready" | "error";

export function EvolutionPage() {
  const { t, lang } = useApp();
  const [data, setData] = useState<EvolutionStatus | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [running, setRunning] = useState(false);

  // 載入進化現況；signal 可中止（卸載時）。供首次 effect 與手動跑完後重整共用。
  const load = useCallback(
    (signal?: AbortSignal) =>
      fetchEvolutionStatus(10, signal)
        .then((res) => {
          if (signal?.aborted) return;
          setData(res);
          setStatus("ready");
        })
        .catch(() => {
          if (signal?.aborted) return;
          setStatus("error");
        }),
    [],
  );

  useEffect(() => {
    const ac = new AbortController();
    // 在 effect 內以 promise 鏈取資料，setState 只發生在 await/then 之後。
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  async function onRun() {
    if (running) return;
    setRunning(true);
    try {
      await runEvolution();
      await load();
    } catch {
      setStatus("error");
    } finally {
      setRunning(false);
    }
  }

  const dateFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "en" ? "en-US" : "zh-TW") : "—";

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title={t("navEvolution")}
        subtitle={t("evolutionPageSub")}
        actions={
          <Button variant="primary" onClick={onRun} disabled={running}>
            <RefreshCw
              className={running ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              aria-hidden
            />
            {running ? t("evoRunning") : t("evoRun")}
          </Button>
        }
      />

      {status === "error" && (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
          <p className="text-[13px] font-medium text-danger">{t("evoError")}</p>
          <p className="mt-1 text-[12px] text-ink-dim">{t("evoNoRunsHint")}</p>
        </div>
      )}

      {status === "loading" && (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center text-[13px] text-ink-dim">
          {t("searching")}
        </div>
      )}

      {status === "ready" && data && (
        <>
          {data.totalRuns === 0 || !data.latest ? (
            <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
              <Brain
                className="mx-auto mb-3 h-7 w-7 text-ink-dim"
                aria-hidden
              />
              <p className="text-[13px] font-medium text-ink">
                {t("evoNoRuns")}
              </p>
              <p className="mt-1 text-[12px] text-ink-dim">
                {t("evoNoRunsHint")}
              </p>
            </div>
          ) : (
            <>
              {/* 最新一輪統計 */}
              <section className="rounded-xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-[14px] font-semibold text-ink">
                    {t("evoLatestRun")}
                  </h2>
                  <span className="text-[12px] text-ink-dim">
                    {t("evoBatch")} {data.latest.batch} ·{" "}
                    {dateFmt(data.latest.createdAt)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <KpiCard
                    label={t("evoTotalRuns")}
                    value={data.totalRuns}
                    icon={Repeat}
                    accent="neutral"
                  />
                  <KpiCard
                    label={t("evoSamplesFeasible")}
                    value={data.latest.feasibleSamples}
                    icon={CircleCheck}
                    accent="high"
                  />
                  <KpiCard
                    label={t("evoSamplesInfeasible")}
                    value={data.latest.infeasibleSamples}
                    icon={CircleSlash}
                    accent="low"
                  />
                  <KpiCard
                    label={t("evoKeywordsAdded")}
                    value={data.latest.keywordsAdded}
                    icon={Plus}
                    accent="signal"
                  />
                  <KpiCard
                    label={t("evoKeywordsUpdated")}
                    value={data.latest.keywordsUpdated}
                    icon={Pencil}
                    accent="priority"
                  />
                </div>
              </section>

              {/* 當前生效詞彙 */}
              <div className="grid gap-5 lg:grid-cols-2">
                <TermCard
                  title={t("evoActivePositive")}
                  terms={data.activePositive}
                  tone="success"
                  empty={t("evoNoTerms")}
                />
                <TermCard
                  title={t("evoActiveNegative")}
                  terms={data.activeNegative}
                  tone="danger"
                  empty={t("evoNoTerms")}
                />
              </div>

              {/* 歷史時間軸 */}
              {data.history.length > 0 && (
                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className="mb-4 text-[14px] font-semibold text-ink">
                    {t("evoHistory")}
                  </h2>
                  <ol className="space-y-3">
                    {data.history.map((log) => (
                      <li
                        key={log.id}
                        className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-ink">
                            {t("evoBatch")} {log.batch}
                          </p>
                          <p className="text-[12px] text-ink-dim">
                            {dateFmt(log.createdAt)} · {log.trigger}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="success">+{log.keywordsAdded}</Badge>
                          <Badge variant="muted">~{log.keywordsUpdated}</Badge>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function TermCard({
  title,
  terms,
  tone,
  empty,
}: {
  title: string;
  terms: EvoTermWeight[];
  tone: "success" | "danger";
  empty: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 text-[14px] font-semibold text-ink">{title}</h2>
      {terms.length === 0 ? (
        <p className="text-[12px] text-ink-dim">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {terms.map((tw) => (
            <Badge key={tw.term} variant={tone} className="gap-1.5">
              <span>{tw.term}</span>
              <span className="tnum opacity-70">{tw.weight.toFixed(2)}</span>
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}
