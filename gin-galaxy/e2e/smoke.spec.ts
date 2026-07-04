import { expect, test } from "@playwright/test";

test("health endpoint reports running dependencies", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);

  const body = await response.json();
  expect(body.status).toBe("healthy");
  expect(body.database).toBe("connected");
  expect(body.deployment.coordinatorMode).toBe("memory");
});

test("auth screen renders for unauthenticated users", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: /gin paradise/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("protected root redirects unauthenticated users to auth", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth$/);
});

test("metrics endpoint exposes Prometheus counters and propagates trace context", async ({
  request,
}) => {
  const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const response = await request.get("/api/metrics", {
    headers: { traceparent },
  });

  expect(response.ok()).toBe(true);
  expect(response.headers()["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  expect(await response.text()).toContain("gin_paradise_requests_total");
});
