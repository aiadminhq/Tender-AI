import { describe, expect, it } from "vitest";
import { resolveApiBase } from "@/lib/api-base";

describe("resolveApiBase", () => {
  it("production 忽略舊外部 API URL，固定走 Vercel 同源路徑", () => {
    expect(
      resolveApiBase(true, "https://stale-backend.invalid/api/v1"),
    ).toBe("/api/v1");
  });

  it("development 可覆寫 API base", () => {
    expect(resolveApiBase(false, "http://127.0.0.1:8000/api/v1")).toBe(
      "http://127.0.0.1:8000/api/v1",
    );
  });

  it("未設定或空白時使用同源預設", () => {
    expect(resolveApiBase(false)).toBe("/api/v1");
    expect(resolveApiBase(false, "   ")).toBe("/api/v1");
  });
});
