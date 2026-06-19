import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTenders, fetchSavedSearches, postSavedSearch } from "@/lib/api";
import type { FilterState } from "@/types/domain";

function makeItem(id: number) {
  return {
    id,
    source: "PCC",
    case_pk: null,
    name: `案 ${id}`,
    org: null,
    category: null,
    budget_wan: null,
    deadline_roc: null,
    deadline_iso: null,
    tender_method: null,
    city: null,
    link: null,
    tier: "mid",
    days_left: null,
    first_seen: null,
    last_seen: null,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchTenders 分頁", () => {
  it("逐頁抓取直到取得全部 count 筆", async () => {
    const total = 450; // 200 + 200 + 50 → 3 頁
    const fetchMock = vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("page"));
      const size = 200;
      const start = (page - 1) * size;
      const items = Array.from(
        { length: Math.max(0, Math.min(size, total - start)) },
        (_, i) => makeItem(start + i + 1),
      );
      return {
        ok: true,
        json: async () => ({ items, count: total, page, page_size: size }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTenders();
    expect(result).toHaveLength(total);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("空頁時中止，避免無限迴圈", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            items: [],
            count: 999,
            page: 1,
            page_size: 200,
          }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTenders();
    expect(result).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

const FILTER: FilterState = {
  query: "醫院",
  sources: ["PCC"],
  tiers: ["high"],
  maxBudget: null,
  focusOnly: false,
  hideExcluded: true,
  sort: "score",
  categories: [],
  orgKeyword: "",
  deadlineFrom: null,
  deadlineTo: null,
  tagFilter: [],
  northOnly: false,
  newToday: false,
};

describe("saved-searches client", () => {
  it("GET 映射 query_text/filter_json → SavedSearch", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => [
            {
              id: 7,
              user_id: 1,
              name: "北部醫院",
              query_text: "醫院",
              filter_json: FILTER,
              created_at: "2026-06-18T00:00:00Z",
            },
          ],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const list = await fetchSavedSearches();
    expect(list).toEqual([{ id: 7, name: "北部醫院", filter: FILTER }]);
  });

  it("POST 送出 name/query_text/filter_json 並回映射結果", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        name: "北部醫院",
        query_text: "醫院",
        filter_json: FILTER,
      });
      return {
        ok: true,
        json: async () => ({
          id: 9,
          user_id: 1,
          name: "北部醫院",
          query_text: "醫院",
          filter_json: FILTER,
          created_at: "2026-06-18T00:00:00Z",
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const row = await postSavedSearch("北部醫院", FILTER);
    expect(row).toEqual({ id: 9, name: "北部醫院", filter: FILTER });
  });

  it("純 mock 模式（VITE_USE_API=false）不外連", async () => {
    vi.stubEnv("VITE_USE_API", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchSavedSearches()).toEqual([]);
    expect(await postSavedSearch("x", FILTER)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
