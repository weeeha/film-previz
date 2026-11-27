import { test, expect } from "@playwright/test";

const routes: Array<[string, string]> = [
  ["#/", "Scenes"],
  ["#/stage", "Stage"],
  ["#/shots", "Shots"],
];

for (const [hash, heading] of routes) {
  test(`route ${hash} renders the ${heading} heading`, async ({ page }) => {
    await page.goto("/" + hash);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator('.tabs a[aria-current="page"]')).toHaveText(heading);
  });
}

test("tab navigation switches routes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Stage" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  await page.getByRole("link", { name: "Shots" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Shots" })).toBeVisible();
});
