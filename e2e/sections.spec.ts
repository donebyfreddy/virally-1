import { expect, test } from "@playwright/test";

test.describe("multiplier", () => {
  test("controls update the computed output", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#multiplier");
    await section.scrollIntoViewIfNeeded();

    // The computed summary, not the graph column that shares the word "Assets".
    const assets = section.locator("dl div").filter({ hasText: /^\d+Assets$/ });
    await expect(assets).toContainText("18");

    // 3 → 6 concepts doubles every downstream figure.
    const concepts = section.getByLabel("Concepts", { exact: true });
    await concepts.fill("6");
    await expect(assets).toContainText("36");
  });

  test("at least one format always remains selected", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#multiplier");
    await section.scrollIntoViewIfNeeded();

    const group = section.getByRole("group", { name: "Formats" });
    const selected = group.getByRole("button", { pressed: true });
    const count = await selected.count();
    // Deselect all but one; the last must refuse.
    for (let i = 0; i < count; i += 1) {
      const btn = selected.first();
      if (await btn.isDisabled()) break;
      await btn.click();
    }
    await expect(group.getByRole("button", { pressed: true })).toHaveCount(1);
  });

  test("exposes a structured list equivalent of the graph", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#multiplier");
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("button", { name: /View as a structured list/i }).click();
    await expect(section.getByText(/One brief produces/)).toBeVisible();
  });

  test("sliders are keyboard operable", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#multiplier");
    await section.scrollIntoViewIfNeeded();
    const concepts = section.getByLabel("Concepts", { exact: true });
    await concepts.focus();
    await page.keyboard.press("ArrowRight");
    await expect(concepts).toHaveValue("4");
  });
});

test.describe("format engine", () => {
  test("selecting a format changes the described recomposition", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#formats");
    await section.scrollIntoViewIfNeeded();

    await expect(section.getByText(/Reels · Shorts · TikTok/)).toBeVisible();
    await section.getByRole("radio", { name: /16:9/ }).click();
    await expect(section.getByText(/YouTube · Landscape/)).toBeVisible();
  });

  test("segmented control supports arrow keys", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#formats");
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("radio", { name: /9:16/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(section.getByRole("radio", { name: /4:5/ })).toBeChecked();
  });
});

test.describe("channels", () => {
  test("states the OAuth-only policy verbatim", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(
        "Connect accounts through official authorisation flows. Virally never asks for your social passwords.",
      ),
    ).toBeVisible();
  });

  test("states the account-creation boundary", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(/does not create social accounts on your behalf/),
    ).toBeVisible();
  });
});

test.describe("laboratory", () => {
  test("discloses that the model is illustrative", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Illustrative model. Individual results vary."),
    ).toBeVisible();
  });

  test("switching variant changes the completion figure", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#results");
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("radio", { name: /Hook A/ }).click();
    await expect(section.getByText("28%").first()).toBeVisible();
  });

  test("chart has a table equivalent", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#results");
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("button", { name: /Retention data as a table/i }).click();
    await expect(section.getByRole("table")).toBeVisible();
  });

  test("playback starts paused and is togglable", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#results");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("button", { name: "Play" })).toBeVisible();
    await section.getByRole("button", { name: "Play" }).click();
    await expect(section.getByRole("button", { name: "Pause" })).toBeVisible();
  });
});

test.describe("use cases", () => {
  test("role selection changes the workflow shown", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#use-cases");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText(/consistent publishing system/)).toBeVisible();
    await section.getByRole("radio", { name: "Agency" }).click();
    await expect(section.getByText(/without mixing assets/)).toBeVisible();
  });
});

test.describe("pricing", () => {
  test("toggle switches billing period", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#pricing");
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("radio", { name: "Annual" }).click();
    await expect(section.getByRole("radio", { name: "Annual" })).toBeChecked();
  });

  test("shows no invented price and flags placeholders", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#pricing");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText("[PRICE REQUIRED]").first()).toBeVisible();
    await expect(section.getByText(/Pricing is not finalised/)).toBeVisible();
  });

  test("uses no fake scarcity or popularity ribbon", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    expect(body.toLowerCase()).not.toContain("most popular");
    expect(body.toLowerCase()).not.toContain("limited time");
    expect(body.toLowerCase()).not.toContain("offer ends");
  });

  test("each tier answers one objection", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#pricing");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText(/Will this just produce generic content\?/)).toBeVisible();
    await expect(section.getByText(/How do I keep client work separated\?/)).toBeVisible();
    await expect(section.getByText(/Can our security team approve this\?/)).toBeVisible();
  });
});

test.describe("honesty guarantees", () => {
  test("makes no virality or reach promise anywhere on the page", async ({ page }) => {
    await page.goto("/");
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of [
      "guaranteed viral",
      "guarantee virality",
      "go viral",
      "10x reach",
      "instant growth",
      "#1 ai",
      "number one ai",
    ]) {
      expect(body, `page must not claim "${banned}"`).not.toContain(banned);
    }
  });

  test("states the limitation explicitly in the footer", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(/does not guarantee reach, growth or virality/),
    ).toBeVisible();
  });

  test("labels illustrative data wherever it appears", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Illustrative sample data/).first()).toBeVisible();
  });
});

test.describe("structure and SEO", () => {
  test("has exactly one h1 and a descending heading order", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);

    const levels = await page
      .locator("h1, h2, h3")
      .evaluateAll((nodes) => nodes.map((n) => Number(n.tagName[1])));

    for (let i = 1; i < levels.length; i += 1) {
      // A heading may never jump more than one level deeper than the last.
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  test("exposes landmarks", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
    await expect(page.locator("header")).toHaveCount(1);
  });

  test("emits structured data without invented ratings or prices", async ({ page }) => {
    await page.goto("/");
    const raw = await page.locator('script[type="application/ld+json"]').innerText();
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(raw).not.toContain("aggregateRating");
    expect(raw).not.toContain("offers");
  });

  test("serves robots and sitemap", async ({ page, baseURL }) => {
    const robots = await page.request.get(`${baseURL}/robots.txt`);
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toContain("Sitemap");

    const sitemap = await page.request.get(`${baseURL}/sitemap.xml`);
    expect(sitemap.ok()).toBe(true);
  });
});
