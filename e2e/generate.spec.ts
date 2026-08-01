import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The four generation studios and the overview above them.
 *
 * Nothing here submits a generation. `startGenerationAction` reserves credits
 * against the ledger and enqueues a provider run, and an e2e suite that does
 * that on every pass leaves a trail of orphaned reservations in whatever
 * database the run happened to point at — there is no worker in this
 * environment to settle them and release the hold. Everything below asserts the
 * PRE-SUBMIT state: what the form offers, what it costs, and why the button can
 * or cannot be pressed. The four assertions that genuinely need a finished
 * generation are at the bottom, written and skipped rather than absent.
 */

/** Fails the test on any console error or page exception. */
function assertCleanConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return () => errors;
}

/**
 * Blocks until every running CSS animation has finished.
 *
 * The model picker and the reference library both open with a pop-in, and an
 * element mid-animation is "not stable" to Playwright's actionability check —
 * a click on a row that is still moving retries until it times out. Waiting on
 * `getAnimations()` rather than a fixed delay keeps this correct if the timings
 * change.
 */
async function waitForAnimationsToSettle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) =>
        animation.playState === "running" ? animation.finished.catch(() => {}) : null,
      ),
    ),
  );
}

const STUDIOS = [
  { route: "/app/generate", nav: "Overview", heading: "Generate" },
  { route: "/app/generate/image", nav: "Image", heading: "Image studio" },
  { route: "/app/generate/video", nav: "Video", heading: "Video studio" },
  { route: "/app/generate/audio", nav: "Audio", heading: "Audio studio" },
  { route: "/app/generate/lip-sync", nav: "Lip sync", heading: "Lip sync studio" },
] as const;

/**
 * Why half the assertions below cannot run on an unconfigured checkout.
 *
 * `readAvailableModels` filters the catalogue down to providers whose
 * credential is set (see `ProviderRouter.availableModels`), so with neither key
 * present the model list is EMPTY: there is nothing to search, nothing to pin,
 * no per-model reference slots and no quotable cost. Those tests are skipped
 * with this reason rather than rewritten to assert the degraded state, because
 * a suite that only ever proves the empty case would go green the day the
 * picker stops working for a real catalogue.
 *
 * To run them: set MUAPI_API_KEY (or MAGNIFIC_API_KEY) before the web server
 * starts. The value is never dereferenced by anything this suite touches — the
 * catalogue read only checks that a credential is present.
 */
const NO_PROVIDER =
  "No generation provider is configured (MAGNIFIC_API_KEY / MUAPI_API_KEY unset), so the model catalogue is empty and there is nothing to act on.";

/**
 * Read from the page rather than from `process.env`.
 *
 * The credential is loaded by Next from `.env`, which the Playwright process
 * does not parse — deciding from `process.env` here would skip tests that the
 * server is perfectly able to serve. The banner is rendered by exactly the same
 * `isConfigured()` calls the catalogue read uses, so it is the honest signal.
 */
async function providerConfigured(page: Page): Promise<boolean> {
  return (await page.getByText("Provider configuration required").count()) === 0;
}

const summaryOf = (page: Page) =>
  page.getByRole("complementary", { name: "Before you generate" });

const generateButton = (page: Page) =>
  page.getByRole("button", { name: "Generate", exact: true });

/** The value beside a `<dt>` in the summary rail, by its label. */
async function summaryValue(page: Page, label: string): Promise<string> {
  const summary = summaryOf(page);
  const labels = await summary.getByRole("term").allInnerTexts();
  const values = await summary.getByRole("definition").allInnerTexts();
  const index = labels.findIndex((entry) => entry.trim() === label);
  expect(index, `summary has no "${label}" row`).toBeGreaterThanOrEqual(0);
  return values[index]?.trim() ?? "";
}

/**
 * Expands the model picker and waits for the panel to stop moving.
 *
 * The collapsed control is named for the current selection, which is Automatic
 * on a freshly loaded form — that is also what makes it a usable handle here.
 */
async function openModelPicker(page: Page) {
  await page.getByRole("button", { name: "Automatic", exact: true }).click();
  await waitForAnimationsToSettle(page);
}

/**
 * Every route here is `force-dynamic` and issues five Neon round trips per
 * render — measured at ~7s served alone and ~12s under the parallel workers
 * this config runs. The 30s default is not enough for a test that navigates
 * more than once, and a timeout that only fires under contention is
 * indistinguishable from a real hang.
 */
test.beforeEach(() => {
  test.setTimeout(90_000);
});

test.describe("generation studios", () => {
  /**
   * The floor: five routes that must render at all. Each was a separate server
   * component with its own session, tenant and data read, and a studio that
   * throws server-side degrades to the route's error boundary rather than to
   * anything a smoke test of one page would notice.
   */
  for (const studio of STUDIOS) {
    test(`${studio.route} renders one h1 with no console errors`, async ({ page }) => {
      const errors = assertCleanConsole(page);
      // Not `networkidle`: Next keeps a connection open, so it never settles.
      await page.goto(studio.route);

      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveText(studio.heading);
      // Exactly one. The app shell, the page header and the studio card all
      // render titles, and a second h1 among them breaks heading navigation.
      await expect(h1).toHaveCount(1);

      await page.waitForLoadState("load");
      expect(errors().join("\n")).toBe("");
    });
  }

  /**
   * The capability rail is the only way between studios, and `aria-current`
   * is the only non-colour signal of which one you are in — the active tab is
   * otherwise a brand-tinted chip, which is invisible to a reader that does not
   * render hue.
   */
  test("the capability nav moves between studios and marks the current one", async ({
    page,
  }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate");
    const nav = page.getByRole("navigation", { name: "Generation studios" });

    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    for (const studio of STUDIOS.slice(1)) {
      await nav.getByRole("link", { name: studio.nav, exact: true }).click();
      await page.waitForURL(`**${studio.route}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(studio.heading);

      const link = nav.getByRole("link", { name: studio.nav, exact: true });
      await expect(link).toHaveAttribute("aria-current", "page");
      // Exactly one current item — two would be worse than none.
      await expect(nav.locator("[aria-current='page']")).toHaveCount(1);
    }

    expect(errors().join("\n")).toBe("");
  });

  /**
   * Automatic is the product's claim that the router picks for you. If a
   * catalogue row were ever pre-selected instead, every user would silently run
   * whichever model happened to sort first.
   */
  test("the model picker opens on Automatic and offers search and filters", async ({
    page,
  }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");

    // The collapsed control is named for its selection, so this is also the
    // assertion that Automatic is the default.
    const toggle = page.getByRole("button", { name: "Automatic", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await waitForAnimationsToSettle(page);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await expect(page.getByLabel("Search models")).toBeVisible();
    await expect(page.getByLabel("Provider", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Capability", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Sort", { exact: true })).toBeVisible();

    await expect(page.getByRole("radio", { name: /^Automatic/ })).toBeChecked();

    expect(errors().join("\n")).toBe("");
  });

  test("searching and the provider filter narrow the model list", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");
    test.skip(!(await providerConfigured(page)), NO_PROVIDER);

    await openModelPicker(page);
    const radios = page.getByRole("radio");
    const all = await radios.count();
    // Automatic plus at least one model, or there is nothing to narrow.
    expect(all).toBeGreaterThan(1);

    // A string no model name contains. Automatic is not a catalogue row and
    // stays; everything else must go.
    await page.getByLabel("Search models").fill("zzzz-no-such-model");
    await expect(radios).toHaveCount(1);
    await expect(page.getByText("No model matches those filters.")).toBeVisible();

    await page.getByLabel("Search models").fill("");
    await expect(radios).toHaveCount(all);

    // Every option on the provider filter is a provider that actually has rows,
    // so picking one can only ever narrow — never empty the list.
    const providerFilter = page.getByLabel("Provider", { exact: true });
    const providers = await providerFilter.locator("option").allInnerTexts();
    expect(providers[0]).toBe("Any provider");
    for (const provider of providers.slice(1)) {
      await providerFilter.selectOption({ label: provider });
      const narrowed = await radios.count();
      expect(narrowed, `provider "${provider}" matched nothing`).toBeGreaterThan(1);
      expect(narrowed).toBeLessThanOrEqual(all);
    }

    expect(errors().join("\n")).toBe("");
  });

  /**
   * Pinning a model has to change the quote, not just the label. The summary is
   * what the user agrees to before pressing Generate, and a picker that changed
   * the name while the price stayed on the router's floor would be quoting one
   * model and running another.
   */
  test("pinning a model updates the summary", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");
    test.skip(!(await providerConfigured(page)), NO_PROVIDER);

    expect(await summaryValue(page, "Model")).toMatch(/^Automatic/);

    await openModelPicker(page);
    // Highest cost first, so the pinned model is the one Automatic would NOT
    // have chosen — otherwise "the summary changed" proves nothing.
    await page.getByLabel("Sort", { exact: true }).selectOption({ label: "Highest cost first" });

    const options = page.getByRole("radio");
    // Index 1: index 0 is Automatic, which is not a catalogue row.
    const pinned = options.nth(1);
    const name = (await pinned.evaluate((el) => el.closest("label")?.textContent ?? ""))
      .trim()
      .split("\n")[0]!
      .trim();

    // The radio itself is `sr-only`, so the label above it takes the pointer and
    // a click never reaches the input. Keyboard selection is what a real user of
    // this control does anyway, and it exercises the native radio group.
    await pinned.focus();
    await page.keyboard.press("Space");
    await expect(pinned).toBeChecked();

    expect(await summaryValue(page, "Model")).toBe(name);
    expect(await summaryValue(page, "Model")).not.toMatch(/^Automatic/);
    // Collapsed control follows the selection, so the choice survives closing.
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();

    expect(errors().join("\n")).toBe("");
  });

  /**
   * The price is shown before the button can be pressed, and it is denominated
   * in Production Credits — never in the provider's own unit and never in
   * currency. The cent basis behind a credit is Virally's cost, not the
   * customer's price, and leaking it here would publish the margin.
   */
  test("the cost is stated in Production Credits before anything is generated", async ({
    page,
  }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");

    const summary = summaryOf(page);
    await expect(summary).toBeVisible();

    const cost = await summaryValue(page, "Estimated cost");
    // "Not quotable" is the honest answer when no configured model can serve the
    // request; it is not a missing figure.
    expect(cost).toMatch(/^(Not quotable|[\d,]+ Production Credits)$/);
    expect(cost).not.toMatch(/muapi|magnific/i);
    expect(await summaryValue(page, "Available")).toMatch(/Production Credits$/);

    // No currency anywhere on the surface — not in the summary, not in the
    // per-model cost table, not on a history card.
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/[$€£]\s?\d/);
    expect(body).not.toMatch(/\bUSD\b/);

    // Shown while the generation has not been started, which is the whole point.
    await expect(generateButton(page)).toBeVisible();
    expect(errors().join("\n")).toBe("");
  });

  test("Generate is disabled with an empty prompt", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");

    const generate = generateButton(page);
    await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("");
    await expect(generate).toBeDisabled();
    // A disabled control that does not say why is a dead end.
    await expect(summaryOf(page).getByText(/^(Write a prompt first\.|No generation provider)/))
      .toBeVisible();

    expect(errors().join("\n")).toBe("");
  });

  test("Generate becomes enabled once a prompt is written", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");
    test.skip(!(await providerConfigured(page)), NO_PROVIDER);

    const generate = generateButton(page);
    await expect(generate).toBeDisabled();
    await page.getByLabel("Prompt", { exact: true }).fill("a matte-black espresso machine at dawn");
    // Enabled even when the balance cannot cover the run: the estimate is a
    // floor and the server's own figure decides, so the shortfall is stated
    // rather than used to block the attempt.
    await expect(generate).toBeEnabled();

    expect(errors().join("\n")).toBe("");
  });

  /**
   * Reference slots are driven by `model.maxReferenceImages`. Rendering them
   * under a model that ignores references invites a user to spend a generation
   * on an input that is discarded, so the section must disappear entirely —
   * both branches are reachable inside the image studio, which offers
   * text-to-image (no references) and image-to-image (references).
   */
  test("reference slots appear only for a model that accepts them", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");
    test.skip(!(await providerConfigured(page)), NO_PROVIDER);

    const references = page.getByRole("heading", { name: "Reference images" });
    const capability = page.getByLabel("What you are making");

    await capability.selectOption({ label: "Text to image" });
    await expect(references).toHaveCount(0);

    await capability.selectOption({ label: "Image to image" });
    await expect(references).toBeVisible();
    // A slot is only useful if it can be filled from the library.
    await expect(page.getByRole("button", { name: /Choose from library/ }).first()).toBeVisible();

    expect(errors().join("\n")).toBe("");
  });

  /**
   * Lip sync is the one capability that animates a real person's face. The
   * confirmation is a precondition on the client and re-checked in
   * `startGenerationAction`, which fails closed — this asserts the client half,
   * that the button is never live while the box is unticked.
   */
  test("the lip-sync consent gate blocks Generate until it is confirmed", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/lip-sync");

    await expect(page.getByRole("heading", { name: "Likeness and voice" })).toBeVisible();
    const consent = page.getByRole("checkbox", { name: /I have permission from the person/ });
    await expect(consent).not.toBeChecked();
    await expect(generateButton(page)).toBeDisabled();

    if (!(await providerConfigured(page))) {
      // The missing credential is reported first, so consent cannot be shown to
      // be the operative blocker here. The gate is still asserted above.
      test.skip(true, NO_PROVIDER);
    }

    const summary = summaryOf(page);
    await expect(
      summary.getByText("Confirm the likeness and voice permission first."),
    ).toBeVisible();

    await consent.check();
    await expect(consent).toBeChecked();
    await expect(
      summary.getByText("Confirm the likeness and voice permission first."),
    ).toHaveCount(0);

    expect(errors().join("\n")).toBe("");
  });

  /**
   * With nothing configured the surface stays readable — catalogue, prices,
   * history — but says so. The wording matters: it does NOT promise demo output
   * for a new run, because `startGenerationAction` passes
   * `allowMockFallback: false` and refuses instead. Demo output only ever comes
   * from history, and it carries its own label there.
   */
  test("the provider banner states what an unconfigured deployment can do", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");

    const banner = page.getByText("Provider configuration required");
    if ((await banner.count()) === 0) {
      // A configured deployment must NOT show it — a permanent warning band is
      // one nobody reads.
      await expect(page.getByText(/No generation provider is configured/)).toHaveCount(0);
      expect(errors().join("\n")).toBe("");
      return;
    }

    await expect(banner.first()).toBeVisible();
    await expect(
      page.getByText(/No generation provider is configured, so nothing new can be generated/),
    ).toBeVisible();
    // Named, so an operator knows which credential to go and set.
    await expect(page.getByText(/Providers checked: .*Magnific.*MuAPI/)).toBeVisible();
    // Demo output is described as a property of history, not of the next run.
    await expect(page.getByText(/labelled as demo output/)).toBeVisible();
    // And the form is not taken away.
    await expect(page.getByLabel("Prompt", { exact: true })).toBeEditable();

    expect(errors().join("\n")).toBe("");
  });

  /**
   * The queue is the only part of the studio that changes without the user
   * doing anything, so a state change has to be announced rather than merely
   * repainted. Polite, not assertive: it must not cut across someone typing a
   * prompt.
   */
  test("the in-flight queue is a polite live region", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");

    const queue = page.getByRole("region", { name: "In flight" });
    await expect(queue).toBeVisible();
    // No role maps to a bare live region, so this is an attribute selector by
    // necessity rather than a missing accessible handle.
    await expect(queue.locator("[aria-live='polite']")).toHaveCount(1);
    await expect(queue.locator("[aria-live='assertive']")).toHaveCount(0);
    // The empty state is stated, not blank.
    await expect(queue.getByText("Nothing generating")).toBeVisible();

    expect(errors().join("\n")).toBe("");
  });

  test("has no detectable axe violations on the image studio", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await waitForAnimationsToSettle(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const summary = results.violations.map(
      (v) => `${v.id} (${v.nodes.length}) — ${v.help}`,
    );
    expect(summary.join("\n")).toBe("");
    expect(errors().join("\n")).toBe("");
  });
});

test.describe("studio on a phone", () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) > 430,
    "390px viewport only — the other projects cover the same flow at desktop widths",
  );

  /**
   * The composer is a two-column grid above `xl` and a stack below it, and the
   * summary rail is sticky. Both are the kind of layout that produces a page
   * two pixels wider than the phone and a horizontal scrollbar under every
   * screen — which on a touch device makes vertical scrolling feel broken.
   */
  test("the studio flow is usable at 390px with no horizontal overflow", async ({ page }) => {
    const errors = assertCleanConsole(page);
    await page.goto("/app/generate/image");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const prompt = page.getByLabel("Prompt", { exact: true });
    await prompt.fill("a matte-black espresso machine at dawn");
    await expect(prompt).toHaveValue("a matte-black espresso machine at dawn");

    // The picker opens in place rather than as a popover, so it must not push
    // the page sideways on the narrowest supported viewport.
    const toggle = page.getByRole("button", { name: "Automatic", exact: true });
    await toggle.click();
    await waitForAnimationsToSettle(page);
    await expect(page.getByLabel("Search models")).toBeVisible();

    await expect(summaryOf(page)).toBeVisible();
    await expect(generateButton(page)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal overflow at 390px").toBeLessThanOrEqual(0);

    expect(errors().join("\n")).toBe("");
  });
});

/**
 * Everything downstream of a generation that actually finishes.
 *
 * No provider credential is set and no queue worker runs against this
 * deployment, so a run can be accepted but can never leave `queued` — nothing
 * polls the provider, ingests an asset or writes a terminal state. Each test
 * below is written and skipped with the specific missing piece named, on the
 * `auth.live.spec.ts` precedent: a green suite must never be readable as "the
 * post-generation flow works" when these are the tests that would have proved
 * it.
 */
test.describe("after a generation completes", () => {
  test("a run reaches a terminal state and its asset appears in the history", async ({
    page,
  }) => {
    test.skip(
      true,
      "Needs a provider credential AND a running queue worker: nothing in this environment advances a run past 'queued', so there is no completion to watch.",
    );

    await page.goto("/app/generate/image");
    await page.getByLabel("Prompt", { exact: true }).fill("a matte-black espresso machine at dawn");
    await generateButton(page).click();

    const queue = page.getByRole("region", { name: "In flight" });
    await expect(queue.getByText("Queued")).toBeVisible();
    // The queue polls with backoff and drops the run once it settles, then
    // refreshes the server-rendered history below it.
    await expect(queue.getByText("Nothing generating")).toBeVisible({ timeout: 300_000 });
    await expect(
      page.getByRole("link", { name: "Open" }).first(),
    ).toBeVisible();
  });

  test("a failed run can be retried from the studio", async ({ page }) => {
    test.skip(
      true,
      "Needs a provider that can be made to fail: with no credential the submit is refused before a run row exists, and a refusal is not the failed-run state this asserts.",
    );

    await page.goto("/app/generate/image");
    await page.getByLabel("Prompt", { exact: true }).fill("a matte-black espresso machine at dawn");
    await generateButton(page).click();

    // Only `limit` and `unknown` are offered a retry — a policy or credits
    // refusal cannot succeed on a second press and is not given a button.
    const retry = page.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByText("No credits were used and nothing was generated.")).toBeVisible();
  });

  test("a generated asset can be added to a campaign", async ({ page }) => {
    test.skip(
      true,
      "Needs a completed generation, and the affordance does not exist yet: an asset tile in OutputGrid offers only Open and Download, with no route from a generated asset into a campaign.",
    );

    await page.goto("/app/generate/image");
    const asset = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Open" }) }).first();
    await asset.getByRole("button", { name: /Add to campaign/ }).click();
    await expect(page.getByRole("dialog", { name: /Add to campaign/ })).toBeVisible();
  });

  test("a generated asset can be added to a Remotion composition", async ({ page }) => {
    test.skip(
      true,
      "Needs a completed generation, and the affordance does not exist yet: nothing under src/components/generate links an asset to a Remotion composition.",
    );

    await page.goto("/app/generate/video");
    const asset = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Open" }) }).first();
    await asset.getByRole("button", { name: /Add to composition/ }).click();
    await expect(page.getByRole("dialog", { name: /composition/i })).toBeVisible();
  });
});
