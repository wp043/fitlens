import { expect, test } from "@playwright/test";

test("local server sends browser security headers", async ({ page }) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("analysis API rejects ambient and oversized requests", async ({ request }) => {
  const headerless = await request.post("/api/analyze", {
    data: {},
    failOnStatusCode: false,
  });
  expect(headerless.status()).toBe(403);

  const crossOrigin = await request.post("/api/analyze", {
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    data: "{}",
    failOnStatusCode: false,
  });
  expect(crossOrigin.status()).toBe(403);
  expect(crossOrigin.headers()["access-control-allow-origin"]).toBeUndefined();

  const oversized = await request.post("/api/analyze", {
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3100",
    },
    data: JSON.stringify({ padding: "x".repeat(64_001) }),
    failOnStatusCode: false,
  });
  expect(oversized.status()).toBe(413);
});

test("same-origin browser requests cross the route guard", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    return { status: response.status, body: await response.json() };
  });

  expect(result.status).toBe(400);
  expect(result.body.error.toLowerCase()).toContain("invalid");
});
