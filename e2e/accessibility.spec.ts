import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Blocks until every running CSS animation has finished.
 *
 * Contrast is a property of the settled state. An element sampled mid-fade
 * reports its composited colour — the auth panel's staggered entry produced a
 * measured 2.39:1 at 300ms that no reader ever sees, and rises to compliant once
 * the animation completes. Waiting on `getAnimations()` rather than a fixed
 * timeout means this stays correct if the stagger timings change.
 */
async function waitForAnimationsToSettle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) =>
        // A paused or infinite animation never resolves; those are decorative
        // loops and are not part of the settled state.
        animation.playState === "running" ? animation.finished.catch(() => {}) : null,
      ),
    ),
  );
}

test.describe("accessibility", () => {
  test("has no detectable axe violations at WCAG 2 AA", async ({ page }) => {
    await page.goto("/");
    // Scroll the full page so lazily-revealed sections are laid out and
    // content-visibility has resolved before the scan.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    // Let cross-fades settle. WCAG contrast applies to the settled state; a
    // panel sampled 100ms into a 240ms fade reports a blended colour that no
    // reader ever sees.
    await page.waitForTimeout(800);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const summary = results.violations.map(
      (v) => `${v.id} (${v.nodes.length}) — ${v.help}`,
    );
    expect(summary.join("\n")).toBe("");
  });

  /**
   * The auth routes are scanned separately rather than folded into the page
   * above: they are a different layout with the product's only real forms, and a
   * single combined assertion would not say which surface failed.
   */
  for (const route of [
    "/auth/sign-up",
    "/auth/sign-in",
    "/auth/forgot-password",
    "/auth/update-password",
    "/auth/auth-error?reason=oauth_cancelled",
  ]) {
    test(`has no detectable axe violations on ${route}`, async ({ page }) => {
      await page.goto(route);
      await waitForAnimationsToSettle(page);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const summary = results.violations.map(
        (v) => `${v.id} (${v.nodes.length}) — ${v.help}`,
      );
      expect(summary.join("\n")).toBe("");
    });
  }

  test("the sign-up form reports its error state accessibly", async ({ page }) => {
    await page.goto("/auth/sign-up");
    const password = page.getByLabel("Password", { exact: true });

    // The requirements checklist must be announced, not merely coloured.
    await password.fill("short");
    await expect(page.getByText("— not met").first()).toBeAttached();
    await waitForAnimationsToSettle(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations.map((v) => v.id).join(",")).toBe("");
  });

  test("reflows at 200% zoom without horizontal overflow", async ({ page, viewport }) => {
    // WCAG 1.4.10 reflow. Doubling the page zoom halves the usable CSS width,
    // so a half-width viewport is the faithful equivalent. Setting
    // `document.documentElement.style.zoom` is NOT: it scales rendered content
    // while leaving clientWidth unchanged, so every element "overflows".
    const width = Math.max(320, Math.round((viewport?.width ?? 1440) / 2));
    await page.setViewportSize({ width, height: viewport?.height ?? 900 });
    await page.goto("/");
    await page.waitForTimeout(200);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(2);
  });

  test("every section heading is reachable and labelled", async ({ page }) => {
    await page.goto("/");
    const sections = page.locator("section[aria-labelledby]");
    const count = await sections.count();
    expect(count).toBeGreaterThan(5);

    for (let i = 0; i < count; i += 1) {
      const id = await sections.nth(i).getAttribute("aria-labelledby");
      expect(id).toBeTruthy();
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test("no element traps keyboard focus", async ({ page }) => {
    await page.goto("/");
    let previous = "";
    let repeats = 0;

    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Tab");
      const signature = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return "none";
        return `${el.tagName}:${el.textContent?.trim().slice(0, 24) ?? ""}:${el.getAttribute("href") ?? ""}`;
      });
      // Focus leaving the document for browser chrome reports as BODY. That is
      // the tab order wrapping around, not a trap.
      if (signature.startsWith("BODY")) {
        repeats = 0;
        continue;
      }
      repeats = signature === previous ? repeats + 1 : 0;
      previous = signature;
      // The same element focused five times running means we cannot escape it.
      expect(repeats, `focus appears trapped on ${signature}`).toBeLessThan(5);
    }
  });
});

test.describe("reduced motion", () => {
  test.skip(
    ({ contextOptions }) => contextOptions.reducedMotion !== "reduce",
    "reduced-motion project only",
  );

  test("delivers the complete product story with no pinned sequence", async ({
    page,
  }) => {
    await page.goto("/");

    // Every section still present.
    for (const id of [
      "hero",
      "proof",
      "bottleneck",
      "workflow",
      "multiplier",
      "formats",
      "channels",
      "results",
      "outputs",
      "use-cases",
      "pricing",
      "start",
    ]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }

    // All five pipeline acts readable at once rather than revealed by scroll.
    for (const act of ["Strategy", "Create", "Adapt", "Distribute", "Learn"]) {
      await expect(page.getByText(act, { exact: false }).first()).toBeAttached();
    }
  });

  test("the Multiplier stays fully interactive", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#multiplier");
    await section.scrollIntoViewIfNeeded();
    const concepts = section.getByLabel("Concepts", { exact: true });
    await concepts.fill("5");
    await expect(concepts).toHaveValue("5");
  });
});
