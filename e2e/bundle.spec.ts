import { test } from "@playwright/test";
test.skip(!process.env.PERF, "set PERF=1 to measure");
test("first-load JS", async ({ page }) => {
  await page.goto(process.env.BUNDLE_PATH || "/", { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const es = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const sum = (f: (e: PerformanceResourceTiming) => boolean) =>
      es.filter(f).reduce((a, e) => a + (e.encodedBodySize || 0), 0);
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return {
      js: sum((e) => e.name.includes(".js")),
      font: sum((e) => /\.woff2?$/.test(e.name)),
      css: sum((e) => e.name.includes(".css")),
      doc: nav?.encodedBodySize || 0,
      count: es.filter((e) => e.name.includes(".js")).length,
    };
  });
  console.log(`ENC_JS_KB=${(r.js/1024).toFixed(1)} chunks=${r.count} ENC_FONT_KB=${(r.font/1024).toFixed(1)} ENC_CSS_KB=${(r.css/1024).toFixed(1)} ENC_DOC_KB=${(r.doc/1024).toFixed(1)}`);
});
