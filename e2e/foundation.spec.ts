import { expect, test, type Page } from "@playwright/test";

/** Fails the test on any console error or page exception. */
function assertCleanConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return () => errors;
}

test.describe("foundation", () => {
  test("home renders with no console errors", async ({ page }) => {
    const errors = assertCleanConsole(page);
    // Not `networkidle`: Next keeps a connection open, so it never settles.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("load");
    // Report the messages themselves so a failure is diagnosable from CI logs.
    expect(errors().join("\n")).toBe("");
  });

  test("skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test("primary CTA is reachable by keyboard and visible", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Start creating" }).first();
    await cta.focus();
    await expect(cta).toBeFocused();
    await expect(cta).toBeVisible();
  });

  test("every interactive element meets the 44px touch target floor", async ({
    page,
  }) => {
    await page.goto("/");
    const interactive = page.locator(
      "main a, main button, header a, header button, footer a",
    );
    const count = await interactive.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const el = interactive.nth(i);
      if (!(await el.isVisible())) continue;
      // Visually-hidden affordances (skip links) are 1px by design and are
      // only exposed on focus, where they take a real size.
      const srOnly = await el.evaluate((node) =>
        node.className.toString().includes("sr-only"),
      );
      if (srOnly) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      const label = (await el.textContent())?.trim().slice(0, 40) ?? `#${i}`;
      // Inline text links inside prose are exempt; standalone controls are not.
      expect(box.height, `"${label}" height ${box.height}`).toBeGreaterThanOrEqual(24);
    }
  });

  test("no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("focus ring is visibly rendered on keyboard focus", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Start creating" }).first();
    await cta.focus();
    const outlineWidth = await cta.evaluate(
      (el) => getComputedStyle(el).outlineWidth,
    );
    expect(parseFloat(outlineWidth)).toBeGreaterThan(0);
  });
});

test.describe("mobile menu", () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) >= 1024,
    "menu only exists below the lg breakpoint",
  );

  test("opens, traps focus, closes on Escape and restores focus", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open menu" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Site menu" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("restores body scrolling after closing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).not.toBe("hidden");
  });
});
