import { test, expect, chromium } from "@playwright/test";

// Opt-in: launches its own throttled browser, so it is skipped in normal runs.
// Run with: PERF=1 npx playwright test --project=desktop-1440 e2e/perf.spec.ts
test.skip(!process.env.PERF, "set PERF=1 to measure");

type LcpEntry = PerformanceEntry & { element?: Element | null };
type ShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };

test("LCP under 4x CPU + 4G", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);

  await client.send("Network.enable");
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    // Regular 4G: 1.6 Mbps down, 750 Kbps up, 150ms RTT.
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 150,
  });

  await page.goto("http://127.0.0.1:3100/", { waitUntil: "load" });
  await page.waitForTimeout(4000);

  const metrics = await page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number; el: string }>((resolve) => {
        let lcp = 0;
        let cls = 0;
        let el = "";

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as LcpEntry[]) {
            lcp = entry.startTime;
            el = entry.element?.tagName ?? "unknown";
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as ShiftEntry[]) {
            if (!entry.hadRecentInput) cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });

        setTimeout(() => resolve({ lcp, cls, el }), 600);
      }),
  );

  console.log(
    `LCP_MS=${metrics.lcp.toFixed(0)} CLS=${metrics.cls.toFixed(4)} LCP_EL=${metrics.el}`,
  );

  await browser.close();

  expect(metrics.lcp).toBeLessThan(2000);
  expect(metrics.cls).toBeLessThan(0.05);
});
