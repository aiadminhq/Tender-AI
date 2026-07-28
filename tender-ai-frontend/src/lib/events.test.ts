import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEventAwait } from "@/lib/events";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("trackEventAwait", () => {
  it("帶入 production API gate 所需的 X-API-Key", async () => {
    vi.stubEnv("VITE_API_KEY", "test-api-key");
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(trackEventAwait("view", { tenderId: "42" })).resolves.toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-API-Key": "test-api-key",
        }),
      }),
    );
  });
});
