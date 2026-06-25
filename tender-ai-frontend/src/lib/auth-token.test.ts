import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { setToken, clearToken, getToken } from "@/lib/auth-token";

// Node 環境無 localStorage；用最小 in-memory 實作補全供測試。
beforeAll(() => {
  const store: Record<string, string> = {};
  const ls = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: ls,
    writable: true,
  });
});

afterEach(() => clearToken());

describe("auth-token", () => {
  it("set/get/clear round-trip", () => {
    setToken("abc.def");
    expect(getToken()).toBe("abc.def");
    clearToken();
    expect(getToken()).toBeNull();
  });
});
