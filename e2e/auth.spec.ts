import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 1 authentication coverage.
 *
 * These tests run against a build with no database/auth configured, which is
 * the state of the repository. That constrains what is provable here:
 *
 * PROVABLE — routing, redirects, the protected-route gate, form structure,
 * accessibility, the 390px layout, reduced motion, and that a non-functional
 * integration is presented honestly rather than as a working button.
 *
 * NOT PROVABLE without credentials — that a real account is created, that a
 * session persists across a refresh, or that Google returns a session. Those
 * assertions are written in `auth.live.spec.ts` and are skipped until
 * DATABASE_URL and BETTER_AUTH_SECRET are set, so a green run here is never
 * mistaken for proof that sign-in works end to end.
 */

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return () => errors;
}

test.describe("CTA wiring", () => {
  test("the primary CTA reaches the real sign-up route, not a placeholder", async ({
    page,
  }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Start creating" }).first();
    await expect(cta).toHaveAttribute("href", "/auth/sign-up");

    await cta.click();
    await expect(page).toHaveURL(/\/auth\/sign-up$/);

    // The placeholder's signature copy must be gone.
    await expect(page.getByText("[PRODUCT APPLICATION REQUIRED]")).toHaveCount(0);
    await expect(
      page.getByText("Sign-up lives in the product application."),
    ).toHaveCount(0);
  });

  test("the old placeholder paths redirect instead of 404ing", async ({ page }) => {
    // Those URLs may already exist in shared links and ad destinations.
    const signup = await page.goto("/signup");
    expect(signup?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/auth\/sign-up$/);

    const login = await page.goto("/login");
    expect(login?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });
});

test.describe("sign-up page", () => {
  test("renders the email form and the Google action with no console errors", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/auth/sign-up");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();

    await page.waitForLoadState("load");
    expect(errors().join("\n")).toBe("");
  });

  test("exposes exactly one h1 and a labelled form", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // Labels, not placeholders. A placeholder disappears on input and is not a
    // label to assistive technology.
    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
  });

  test("the password visibility toggle is a real, named, stateful control", async ({
    page,
  }) => {
    await page.goto("/auth/sign-up");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("a-test-password");
    await expect(password).toHaveAttribute("type", "password");

    const toggle = page.getByRole("button", { name: "Show password" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();

    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the password requirements checklist responds to input", async ({ page }) => {
    await page.goto("/auth/sign-up");
    // `exact` because the same phrase also appears in the field's hint text.
    await expect(
      page.getByText("At least 8 characters", { exact: true }),
    ).toBeVisible();

    // State is carried by a glyph and by screen-reader text, never by colour
    // alone — so the met/not-met text is what is asserted.
    await expect(page.getByText("— not met").first()).toBeAttached();
    await page.getByLabel("Password", { exact: true }).fill("longenoughpassword");
    await expect(page.getByText("— met").first()).toBeAttached();
  });

  test("states the platform-password boundary", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await expect(
      page.getByText(/never asks for your social media passwords/i),
    ).toBeVisible();
  });

  test("carries legal links", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  });

  test("every form control is reachable by keyboard in document order", async ({
    page,
  }) => {
    await page.goto("/auth/sign-up");

    // Walk forward from the top and record what receives focus. The submit
    // button is legitimately absent from this list when Supabase is
    // unconfigured — a disabled control is correctly not focusable — so the
    // assertion is on the fields and the toggle, which are always enabled.
    const reached = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Tab");
      const marker = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "";
        if (el.getAttribute("aria-pressed") !== null) {
          return `${el.tagName}:visibility-toggle`;
        }
        const name =
          el.getAttribute("name") ?? (el.textContent ?? "").trim().slice(0, 24);
        return `${el.tagName}:${name}`;
      });
      if (marker) reached.add(marker);
    }

    expect([...reached].some((m) => m.includes("email"))).toBe(true);
    expect([...reached].some((m) => m.includes("password"))).toBe(true);
    expect([...reached].some((m) => m.includes("visibility-toggle"))).toBe(true);
  });

  test("the submit button is disabled — not silently broken — when unconfigured", async ({
    page,
  }) => {
    await page.goto("/auth/sign-up");
    const submit = page.getByRole("button", { name: "Create account" });
    const configured = await page
      .getByText("CONFIGURATION REQUIRED")
      .count()
      .then((n) => n === 0);

    if (configured) {
      await expect(submit).toBeEnabled();
      await submit.focus();
      await expect(submit).toBeFocused();
    } else {
      // A button that cannot work must not look like it can, and the reason must
      // be on screen.
      await expect(submit).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Continue with Google" }),
      ).toBeDisabled();
      await expect(page.getByText("DATABASE_URL")).toBeVisible();
    }
  });
});

test.describe("sign-in page", () => {
  test("renders and links to password recovery", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Forgot password?" }),
    ).toBeVisible();
  });

  test("password recovery page renders its form", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send reset link" }),
    ).toBeVisible();
    // Must not disclose whether an account exists.
    await expect(page.getByText(/do not disclose whether an account exists/i)).toBeVisible();
  });
});

test.describe("protected routes", () => {
  test("an anonymous visitor cannot reach the product", async ({ page }) => {
    await page.goto("/app");

    // Either redirected to sign-in, or — when no Supabase project is attached —
    // shown the configuration notice. What must never happen is the product
    // rendering as though a session existed.
    const url = page.url();
    const redirected = /\/auth\/sign-in/.test(url);

    if (redirected) {
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    } else {
      await expect(page.getByText("CONFIGURATION REQUIRED")).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  });

  /**
   * Every navigable product route, not just /app.
   *
   * A single spot-check on the root would not catch a new route added without the
   * layout guard — which is exactly the mistake this loop exists to prevent, since
   * each of these was generated from a template.
   */
  const PRODUCT_ROUTES = [
    "/app",
    "/app/create",
    "/app/campaigns",
    "/app/content",
    "/app/calendar",
    "/app/accounts",
    // Claims an account slot on submit, so an unguarded version would let an
    // anonymous request reach a capacity-consuming form.
    "/app/accounts/launch",
    // A dynamic segment guards itself; it is listed because a route with its own
    // params function is the one most easily added without the session check.
    "/app/accounts/00000000-0000-0000-0000-000000000000",
    "/app/analytics",
    "/app/library",
    "/app/experiments",
    "/app/team",
    "/app/usage",
    "/app/settings",
    "/onboarding",
    "/onboarding/complete",
  ];

  for (const route of PRODUCT_ROUTES) {
    test(`${route} is not reachable anonymously`, async ({ page }) => {
      await page.goto(route);

      // Signed-in chrome must never appear: no sign-out, no switchers, no nav.
      await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Product" })).toHaveCount(0);
      await expect(page.getByText("AUTHENTICATED SESSION")).toHaveCount(0);

      // Acceptable outcomes: redirected to sign-in, or — with no Supabase project
      // attached — the configuration notice. Never the product itself.
      const url = new URL(page.url());
      const redirected = url.pathname.startsWith("/auth/sign-in");
      if (!redirected) {
        await expect(page.getByText("CONFIGURATION REQUIRED")).toBeVisible();
      }
    });
  }

  test("a deep protected path never renders product content", async ({ page }) => {
    // `/app/campaigns/*` does not exist until a later phase, so this asserts the
    // invariant that holds regardless: whatever renders, it is not a signed-in
    // surface. The `?next=` preservation itself is covered exhaustively in
    // src/lib/auth/routes.test.ts, where every hostile input can be exercised.
    await page.goto("/app/campaigns/example");

    const url = new URL(page.url());
    if (url.pathname === "/auth/sign-in") {
      expect(url.searchParams.get("next")).toBe("/app/campaigns/example");
    }

    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByText("AUTHENTICATED SESSION")).toHaveCount(0);
  });
});

test.describe("auth error page", () => {
  test("frames a cancelled Google sign-in as a choice, not a failure", async ({
    page,
  }) => {
    await page.goto("/auth/auth-error?reason=oauth_cancelled");
    await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
    await expect(page.getByText(/no account was created or accessed/i)).toBeVisible();
    // The word "error" must not be used for a user's own choice.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sign-in was cancelled.",
    );
  });

  test("does not reflect an arbitrary reason back into the page", async ({ page }) => {
    // Guards against reflecting provider-supplied text — an injection vector.
    const injected = "<img src=x onerror=alert(1)>";
    await page.goto(`/auth/auth-error?reason=${encodeURIComponent(injected)}`);
    await expect(page.getByText(injected)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("responsive and reduced motion", () => {
  test("the sign-up form does not overflow horizontally", async ({ page }) => {
    await page.goto("/auth/sign-up");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });

  test("every interactive control meets the 44px touch floor", async ({ page }) => {
    await page.goto("/auth/sign-up");
    // `[data-inline-link]` is excluded: WCAG 2.5.8 exempts targets inside a
    // sentence, and padding one to 44px would break the line box it sits in.
    // The attribute appears only on links inside prose, never on a control.
    const controls = page.locator(
      "main a:not([data-inline-link]), main button, main input",
    );
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const el = controls.nth(i);
      if (!(await el.isVisible())) continue;
      const isSrOnly = await el.evaluate((node) =>
        node.className.toString().includes("sr-only"),
      );
      if (isSrOnly) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      expect(
        box.height,
        `control ${i} (${await el.evaluate((n) => n.tagName)}) is ${box.height}px tall`,
      ).toBeGreaterThanOrEqual(43.5);
    }
  });

  test("the form is complete and usable with reduced motion", async ({ page }) => {
    // The reduced-motion project sets this at the context level. No content may
    // live inside an animation, so everything must still be present.
    await page.goto("/auth/sign-up");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(page.getByText(/never asks for your social media passwords/i)).toBeVisible();
  });
});
