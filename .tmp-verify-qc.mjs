import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(err.message));

await page.goto("http://localhost:3000/app/create", { waitUntil: "load" });
await page.waitForSelector("h1");
await page.screenshot({ path: "/tmp/qc-1-entry.png", fullPage: true });

// Confirm Quick Content is the default and shows its own form (no campaign fields).
const quickCardSelected = await page.getByRole("button", { name: /Quick Content/ }).getAttribute("aria-pressed");
console.log("Quick Content card aria-pressed:", quickCardSelected);
const hasConceptsField = await page.getByText("Concepts", { exact: false }).count();
console.log("Campaign-only 'Concepts' field visible under Quick Content:", hasConceptsField);

// Fill the quick content brief.
await page.getByPlaceholder(/hidden beaches in Thailand/).fill("Create a 30-second TikTok reel about hidden beaches in Thailand.");
await page.screenshot({ path: "/tmp/qc-2-filled.png", fullPage: true });

// Select TikTok platform explicitly (already default) and submit plan.
const planButton = page.getByRole("button", { name: "Generate plan" });
await planButton.click();

// Wait for the plan view (looks for "Content plan" heading).
await page.waitForSelector("text=Content plan", { timeout: 30000 });
await page.screenshot({ path: "/tmp/qc-3-plan.png", fullPage: true });

const title = await page.locator("h3").first().textContent();
console.log("Planned title:", title);

const bodyText = await page.locator("body").innerText();
console.log("Contains 'Content items 1'-style single count context:", bodyText.includes("Estimated Production Credits"));

console.log("CONSOLE ERRORS SO FAR:", errors.length ? errors.join("\n") : "none");

await browser.close();
