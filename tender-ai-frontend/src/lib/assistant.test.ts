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
