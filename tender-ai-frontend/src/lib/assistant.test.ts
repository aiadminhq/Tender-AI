import { describe, it, expect, vi, afterEach } from "vitest";
import {
  streamAssistantChat,
  fetchAssistantThreads,
  fetchAssistantThread,
} from "@/lib/assistant";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// 把一串 NDJSON 行做成可讀 stream 的 Response.body。
function ndjsonResponse(lines: string[]): Response {
  const text = lines.map((l) => l + "\n").join("");
  const reader = {
    chunks: [new TextEncoder().encode(text)],
    read() {
      const next = this.chunks.shift();
      return Promise.resolve(
        next ? { done: false, value: next } : { done: true, value: undefined },
      );
    },
  };
  return {
    ok: true,
    body: { getReader: () => reader },
  } as unknown as Response;
}

describe("streamAssistantChat 對話留存接線", () => {
  it("帶上 thread_id 與 context.scope，並從 meta 回拋 threadId", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return ndjsonResponse([
        JSON.stringify({
          type: "meta",
          scope: "tender_sql",
          thread_id: "t-server-99",
          prompt: "台北",
          sources: [],
        }),
        JSON.stringify({ type: "delta", text: "嗨" }),
        JSON.stringify({ type: "done" }),
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    let metaThreadId: string | undefined;
    await streamAssistantChat(
      [{ role: "user", text: "台北" }],
      { onMeta: (_scope, _sources, threadId) => (metaThreadId = threadId) },
      undefined,
      null,
      { threadId: "t-1", scope: "assistant" },
    );

    expect(sentBody.thread_id).toBe("t-1");
    expect((sentBody.context as Record<string, unknown>).scope).toBe(
      "assistant",
    );
    expect(metaThreadId).toBe("t-server-99");
  });

  it("在標案頁提問時把當前 focus_tender_id 帶進 context（情境感知接線）", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return ndjsonResponse([JSON.stringify({ type: "done" })]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await streamAssistantChat(
      [{ role: "user", text: "這案適合投嗎" }],
      {},
      undefined,
      "4821", // route /tenders/:id 的 id 多為字串
      { threadId: null, scope: "assistant" },
    );

    const ctx = sentBody.context as Record<string, unknown>;
    expect(ctx.focus_tender_id).toBe("4821");
    expect(ctx.scope).toBe("assistant");
  });

  it("不在標案頁（focusTenderId 為 null）時 context 不含 focus_tender_id", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return ndjsonResponse([JSON.stringify({ type: "done" })]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await streamAssistantChat(
      [{ role: "user", text: "今天有什麼案" }],
      {},
      undefined,
      null,
      { threadId: null, scope: "assistant" },
    );

    const ctx = (sentBody.context ?? {}) as Record<string, unknown>;
    expect(ctx.focus_tender_id).toBeUndefined();
  });

  it("progress 事件走 onProgress、不混入 onText（CLI 大腦暫態狀態）", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        JSON.stringify({ type: "progress", text: "正在查詢標案…" }),
        JSON.stringify({ type: "delta", text: "找到 3 筆" }),
        JSON.stringify({ type: "done" }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const progresses: string[] = [];
    const texts: string[] = [];
    await streamAssistantChat(
      [{ role: "user", text: "台北" }],
      {
        onProgress: (s) => progresses.push(s),
        onText: (t) => texts.push(t),
      },
      undefined,
      null,
      { threadId: null, scope: "assistant" },
    );

    expect(progresses).toEqual(["正在查詢標案…"]);
    expect(texts).toEqual(["找到 3 筆"]);
  });

  it("artifact 事件走 onArtifact、不混入 onText", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        JSON.stringify({
          type: "artifact",
          artifact: {
            type: "table",
            id: "ranking",
            title: "標案排序",
            columns: [
              { key: "name", label: "標案" },
              { key: "score", label: "分數", align: "right" },
            ],
            rows: [{ name: "資訊系統", score: 91 }],
          },
        }),
        JSON.stringify({ type: "delta", text: "已整理成表格。" }),
        JSON.stringify({ type: "done" }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const artifacts: unknown[] = [];
    const texts: string[] = [];
    await streamAssistantChat(
      [{ role: "user", text: "整理成表" }],
      {
        onArtifact: (artifact) => artifacts.push(artifact),
        onText: (t) => texts.push(t),
      },
      undefined,
      null,
      { threadId: null, scope: "assistant" },
    );

    expect(artifacts).toEqual([
      {
        type: "table",
        id: "ranking",
        title: "標案排序",
        caption: null,
        columns: [
          { key: "name", label: "標案" },
          { key: "score", label: "分數", align: "right" },
        ],
        rows: [{ name: "資訊系統", score: 91 }],
      },
    ]);
    expect(texts).toEqual(["已整理成表格。"]);
  });

  it("chart artifact 事件保留 chart contract", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        JSON.stringify({
          type: "artifact",
          artifact: {
            type: "chart",
            id: "weekly",
            title: "近 7 日標案量",
            chartType: "line",
            xKey: "day",
            series: [{ key: "count", label: "件數" }],
            rows: [{ day: "6/22", count: 18 }],
          },
        }),
        JSON.stringify({ type: "done" }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const artifacts: unknown[] = [];
    await streamAssistantChat(
      [{ role: "user", text: "畫趨勢圖" }],
      { onArtifact: (artifact) => artifacts.push(artifact) },
      undefined,
      null,
      { threadId: null, scope: "assistant" },
    );

    expect(artifacts).toEqual([
      {
        type: "chart",
        id: "weekly",
        title: "近 7 日標案量",
        caption: null,
        chartType: "line",
        xKey: "day",
        series: [{ key: "count", label: "件數" }],
        rows: [{ day: "6/22", count: 18 }],
      },
    ]);
  });

  it("actions artifact 事件保留 save/share contract", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        JSON.stringify({
          type: "artifact",
          artifact: {
            type: "actions",
            id: "share-ranking",
            title: "分享本次排序",
            tenderIds: [5, 9],
            actions: ["save", "share", "copy"],
            payload: { source: "assistant" },
          },
        }),
        JSON.stringify({ type: "done" }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const artifacts: unknown[] = [];
    await streamAssistantChat(
      [{ role: "user", text: "收藏並分享" }],
      { onArtifact: (artifact) => artifacts.push(artifact) },
      undefined,
      null,
      { threadId: null, scope: "assistant" },
    );

    expect(artifacts).toEqual([
      {
        type: "actions",
        id: "share-ranking",
        title: "分享本次排序",
        caption: null,
        tenderIds: [5, 9],
        actions: ["save", "share", "copy"],
        payload: { source: "assistant" },
      },
    ]);
  });

  it("artifact 事件會經過 C1 adapter，無效 payload 不送出", async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        JSON.stringify({
          type: "artifact",
          artifact: {
            kind: "chart",
            artifact_id: "weekly",
            chart_type: "bar",
            x_key: "day",
            series: ["count"],
            data: [{ day: "6/23", count: 21 }],
          },
        }),
        JSON.stringify({
          type: "artifact",
          artifact: { kind: "chart", series: [] },
        }),
        JSON.stringify({ type: "done" }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const artifacts: unknown[] = [];
    await streamAssistantChat(
      [{ role: "user", text: "C1 圖表" }],
      { onArtifact: (artifact) => artifacts.push(artifact) },
      undefined,
      null,
      { threadId: null, scope: "assistant" },
    );

    expect(artifacts).toEqual([
      {
        type: "chart",
        id: "weekly",
        title: null,
        caption: null,
        chartType: "bar",
        xKey: "day",
        series: [{ key: "count", label: "count" }],
        rows: [{ day: "6/23", count: 21 }],
      },
    ]);
  });
});

describe("fetchAssistantThreads", () => {
  it("GET 映射 snake_case → camelCase", async () => {
    vi.stubEnv("VITE_USE_API", "true");
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            threads: [
              {
                id: "t-1",
                owner_user_id: "default",
                scope: "assistant",
                title: "台北",
                consent_state: "pending-consent",
                layer_b_opt_in: false,
              },
            ],
          }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const list = await fetchAssistantThreads();
    expect(list).toEqual([{ id: "t-1", scope: "assistant", title: "台北" }]);
  });

  it("純 mock 模式（VITE_USE_API=false）不外連", async () => {
    vi.stubEnv("VITE_USE_API", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchAssistantThreads()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchAssistantThread", () => {
  it("映射訊息與來源；找不到回 null", async () => {
    vi.stubEnv("VITE_USE_API", "true");
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            id: "t-1",
            owner_user_id: "default",
            scope: "assistant",
            title: "台北",
            consent_state: "pending-consent",
            layer_b_opt_in: false,
            messages: [
              { id: 1, role: "user", content: "台北", sources: null },
              {
                id: 2,
                role: "assistant",
                content: "有這些案",
                sources: [
                  {
                    kind: "tender",
                    tender_id: 5,
                    title: "資訊系統",
                    source: "PCC",
                    url: "/t/5",
                    score: null,
                    excerpt: null,
                    doc_id: null,
                    heading: null,
                  },
                ],
              },
            ],
          }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const detail = await fetchAssistantThread("t-1");
    expect(detail?.id).toBe("t-1");
    expect(detail?.turns.map((x) => x.role)).toEqual(["user", "assistant"]);
    expect(detail?.turns[0].text).toBe("台北");
    expect(detail?.turns[1].sources?.[0].tenderId).toBe(5);
  });

  it("404 回 null", async () => {
    vi.stubEnv("VITE_USE_API", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }) as Response),
    );
    expect(await fetchAssistantThread("nope")).toBeNull();
  });
});
