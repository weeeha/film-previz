import { test, expect } from "@playwright/test";

// Spec acceptance criterion 5. A pixel counts as white when its darkest channel is above 128 (mid grey).
// Expected: 50 mm on 36 mm sensor at 10 m, 1 m wide = 13.9 percent; 35 mm = 9.7 percent. Tolerance 0.5 points.
type Run = (f: number, a: number, o?: object) => Promise<{ whitePercent: number; whitePx: number }>;
const measure = (page: import("@playwright/test").Page, f: number) =>
  page.evaluate(([focal]) => (window as unknown as { __box: { run: Run } }).__box.run(focal as number, 16 / 9), [f]);

const cases: Array<[string, number, number]> = [["50 mm", 50, 13.9], ["35 mm", 35, 9.7]];
for (const [label, focal, expected] of cases) {
  test(`box fills ${expected} percent of the frame width at ${label}`, async ({ page }, info) => {
    await page.goto("/tests/harness/box.html");
    await page.waitForFunction(() => "__box" in window);
    const r = await measure(page, focal);
    console.log(`[${info.project.name}] ${label}: ${r.whitePercent.toFixed(2)} percent (${r.whitePx} px of 1920)`);
    expect(Math.abs(r.whitePercent - expected)).toBeLessThanOrEqual(0.5);
  });
}
