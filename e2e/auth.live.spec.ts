import { expect, test } from "@playwright/test";

/**
 * Assertions that require a real Neon database and Better Auth configuration.
 *
 * Skipped — loudly — when none is configured. The point of a separate file is
 * that a green suite on an unconfigured checkout can never be read as "sign-in
 * works": these are the tests that would prove it, and the report shows them as
 * skipped rather than absent.
 *
 * To run: set DATABASE_URL, BETTER_AUTH_SECRET and E2E_TEST_EMAIL_DOMAIN, and
 * allow-list <origin>/api/auth/callback/google as an authorized redirect URI
 * in the Google OAuth client.
 */

const configured = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);

test.describe("live authentication", () => {
  test.skip(
    !configured,
    "No database configured — set DATABASE_URL and BETTER_AUTH_SECRET to run.",
  );

  test("rejects a wrong password with an actionable message", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill("nobody@virally-e2e.test");
    await page.getByLabel("Password", { exact: true }).fill("wrong-password-here");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Scoped to `main`: Next injects its own empty role="alert" route announcer at the
    // document level, which otherwise makes this a strict-mode violation.
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/not correct/i);
    // The developer-facing wording must never reach the user.
    await expect(alert).not.toContainText(/APIError/);
  });

  test("does not disclose whether an address is registered", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email").fill("definitely-not-registered@example.invalid");
    await page.getByRole("button", { name: "Send reset link" }).click();

    const status = page.getByRole("status");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/if an account exists/i);
  });

  test("the Google button reflects whether the provider is actually configured", async ({
    page,
  }) => {
    // Availability is now a pure function of AUTH_GOOGLE_CLIENT_ID/SECRET
    // (see src/lib/auth/providers.ts) — no live network probe, so this is
    // deterministic rather than a "could it reach Supabase" check.
    await page.goto("/auth/sign-in");
    const button = page.getByRole("button", { name: "Continue with Google" });
    await expect(button).toBeVisible();

    const enabled = await button.isEnabled();
    if (enabled) {
      await button.click();
      await page.waitForURL(/accounts\.google\.com/);
    } else {
      // Disabled is only acceptable alongside an actionable explanation.
      await expect(page.getByText(/AUTH_GOOGLE_CLIENT_ID/)).toBeVisible();
    }
  });

  test("a session survives a full page reload", async () => {
    // Requires a seeded confirmed test account. Fill this in alongside the
    // Phase 2 test fixtures, which is what creates one.
    test.fixme(
      true,
      "Needs the seeded test account from the Phase 2 migration fixtures.",
    );
  });
});
