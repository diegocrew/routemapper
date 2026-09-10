import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("plans, selects and edits routes without losing the map", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const longTasks: number[] = [];
    Object.assign(window, { routeMapperLongTasks: longTasks });
    new PerformanceObserver((list) => {
      longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Route Mapper", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide active hazards (excluding wildfires)", exact: true })).toBeVisible();
  const startup = await page.evaluate(() => ({
    readyMs: performance.now(),
    navigation: performance.getEntriesByType("navigation").map((entry) => entry.toJSON()),
    paint: performance.getEntriesByType("paint").map((entry) => entry.toJSON()),
    longTasks: (window as unknown as { routeMapperLongTasks: number[] }).routeMapperLongTasks,
    resources: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/assets/")).map((entry) => entry.toJSON()),
  }));
  await writeFile(testInfo.outputPath("startup.json"), JSON.stringify(startup, null, 2));
  await testInfo.attach("startup.json", { body: JSON.stringify(startup, null, 2), contentType: "application/json" });

  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(300);
  expect(box?.height).toBeGreaterThan(250);
  if (testInfo.project.name === "mobile") {
    const panel = await page.locator(".panel").boundingBox();
    expect(panel!.y + 1).toBeGreaterThanOrEqual(box!.y + box!.height);
    await expect(page.getByRole("button", { name: "Legend", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".maplibregl-ctrl-attrib")).not.toHaveClass(/maplibregl-compact-show/);
  }

  const mapPixels = await canvas.screenshot();
  const distinctColors = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
    const surface = new OffscreenCanvas(image.width, image.height);
    const context = surface.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(Math.floor(image.width * 0.45), Math.floor(image.height * 0.2), Math.floor(image.width * 0.4), Math.floor(image.height * 0.5));
    const colors = new Set<string>();
    for (let offset = 0; offset < data.length; offset += 16) {
      colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
    }
    image.close();
    return colors.size;
  }, [...mapPixels]);
  expect(distinctColors).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(async () => (await canvas.screenshot()).equals(mapPixels)).toBe(false);

  await page.getByLabel("Departs", { exact: true }).fill("2030-01-15");
  await page.getByLabel("From", { exact: true }).selectOption("shanghai");
  await page.getByLabel("To", { exact: true }).selectOption("rotterdam");
  await expect(page.getByRole("button", { name: /^Cheapest/ })).toBeVisible();
  const fastest = page.getByRole("button", { name: /^Fastest/ });
  await fastest.click();
  await expect(fastest).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Departs", { exact: true }).fill("2030-07-15");
  await expect(page.locator(".route-card.selected")).toBeVisible();

  await page.getByLabel("Add Via", { exact: true }).selectOption("singapore");
  await expect(page.locator(".waypoint-list")).toContainText("Singapore");
  await expect(page.locator(".route-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Remove Singapore", exact: true }).click();
  await expect(page.locator(".waypoint-list")).toHaveCount(0);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("rotterdam");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("shanghai");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("heading", { name: "Route Mapper", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("route.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator(".route-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});