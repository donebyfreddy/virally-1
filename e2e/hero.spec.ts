import { expect, test } from "@playwright/test";

test.describe("hero", () => {
  test("headline and CTAs are present", async ({ page }) => {
    await page.goto("/");
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
});
