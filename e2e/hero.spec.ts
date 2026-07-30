import { expect, test } from "@playwright/test";

test.describe("hero", () => {
  test("headline and CTAs are present without waiting for the demo", async ({
    page,
  }) => {
    await page.goto("/");
    // The h1 is server-rendered text and must not depend on the animation.
    await expect(
      page.getByRole("heading", { level: 1, name: /One idea/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Start creating" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Watch the workflow" }),
    ).toBeVisible();
  });

  test("trust microcopy is stated near the CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Review before publishing").first()).toBeVisible();
    await expect(page.getByText("No passwords shared").first()).toBeVisible();
  });

  test("the demonstration is labelled as scripted, not live", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Product demonstration. Scripted, not a live generation."),
    ).toBeVisible();
  });

  test("the full brief is in the accessibility tree from first paint", async ({
    page,
  }) => {
    await page.goto("/");
    // Typed character-by-character visually, but complete for screen readers.
    await expect(
      page.getByText("Create a 7-day campaign about why deep-sea animals glow.", {
        exact: false,
      }).first(),
    ).toBeAttached();
  });

  test("the campaign panel has a text equivalent", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Campaign demonstration/ }),
    ).toBeAttached();
  });
});

test.describe("hero demo controls", () => {
  test.skip(
    ({ contextOptions }) => contextOptions.reducedMotion === "reduce",
    "controls are absent when the timeline never runs",
  );

  test("the demo can be paused and resumed", async ({ page }) => {
    await page.goto("/");
    const pause = page.getByRole("button", { name: "Pause demo" });
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(page.getByRole("button", { name: "Play demo" })).toBeVisible();
    await page.getByRole("button", { name: "Play demo" }).click();
    await expect(page.getByRole("button", { name: "Pause demo" })).toBeVisible();
  });

  test("the demo can be replayed", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("button", { name: "Pause demo" })).toBeVisible();
  });

  test("controls are keyboard reachable", async ({ page }) => {
    await page.goto("/");
    const pause = page.getByRole("button", { name: "Pause demo" });
    await pause.focus();
    await expect(pause).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Play demo" })).toBeVisible();
  });
});

test.describe("hero under reduced motion", () => {
  test.skip(
    ({ contextOptions }) => contextOptions.reducedMotion !== "reduce",
    "reduced-motion project only",
  );

  test("shows the settled campaign with no demo controls", async ({ page }) => {
    await page.goto("/");
    // The whole brief is visible immediately rather than typing in.
    await expect(page.getByText("Three posts per day.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause demo" })).toHaveCount(0);
    // The settled state still communicates the outcome.
    await expect(page.getByText(/posts scheduled/)).toBeVisible();
  });

  test("keeps the complete product explanation", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /One idea/ }),
    ).toBeVisible();
    await expect(page.getByText(/Virally turns a single brief/)).toBeVisible();
  });
});
