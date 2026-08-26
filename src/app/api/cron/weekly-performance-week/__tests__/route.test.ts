import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnsurePreviousDispatchWeek } = vi.hoisted(() => ({
  mockEnsurePreviousDispatchWeek: vi.fn(),
}));

vi.mock("@/lib/performance-week-service", () => ({
  ensurePreviousDispatchWeek: mockEnsurePreviousDispatchWeek,
}));

const { GET } = await import("@/app/api/cron/weekly-performance-week/route");

describe("/api/cron/weekly-performance-week", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: "test-secret" };
  });

  function makeRequest(secret?: string): Request {
    const headers = new Headers();
    if (secret) {
      headers.set("Authorization", `Bearer ${secret}`);
    }
    return new Request("http://localhost/api/cron/weekly-performance-week", {
      headers,
    });
  }

  it("returns 401 when Authorization header is missing", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header is invalid", async () => {
    const response = await GET(makeRequest("wrong-secret"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(makeRequest("test-secret"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/CRON_SECRET not configured/);
  });

  it("calls ensurePreviousDispatchWeek and returns the summary on success", async () => {
    mockEnsurePreviousDispatchWeek.mockResolvedValue({
      created: 2,
      existing: 1,
      weeks: [],
    });

    const response = await GET(makeRequest("test-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, created: 2, existing: 1 });
    expect(mockEnsurePreviousDispatchWeek).toHaveBeenCalledWith();
  });

  it("returns 500 when the service throws", async () => {
    mockEnsurePreviousDispatchWeek.mockRejectedValue(new Error("DB failure"));

    const response = await GET(makeRequest("test-secret"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("DB failure");
  });
});
