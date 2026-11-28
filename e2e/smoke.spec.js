// @ts-check
// Pruebas de humo de la interfaz, en escritorio y en móvil (390 px).
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Cualquier error de JavaScript o de consola hace fallar la prueba.
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

const generation = async (page) => Number(await page.locator("#s-gen").textContent());

async function open(page, url = "/") {
  const errors = watchErrors(page);
  await page.goto(url);
  await expect(page.locator("#s-gen")).toHaveText(/^\d+$/);
  return errors;
}

test("arranca sin errores y Entrenar avanza generaciones", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("#mode-train")).toHaveAttribute("aria-selected", "true");
  const before = await generation(page);
  await page.locator("#next").click();
  await page.locator("#next").click();
  await expect.poll(() => generation(page)).toBeGreaterThanOrEqual(before + 2);
  // Y la simulación corre sola: el contador de coches en pista se mueve.
  await expect(page.locator("#s-alive")).toHaveText(/^\d+\/\d+$/);
  expect(errors).toEqual([]);
});

test("en el editor se añade un punto", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#mode-edit").click();
  await expect(page.locator("#app")).toHaveAttribute("data-mode", "edit");
  await expect(page.locator("#finish")).toBeDisabled();
  const box = await page.locator("#world").boundingBox();
  if (!box) throw new Error("sin lienzo");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
  // El punto nuevo queda seleccionado: ya se puede terminar el tramo.
  await expect(page.locator("#finish")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("Turbo entrena y Detener vuelve a la pista", async ({ page }) => {
  const errors = await open(page);
  const before = await generation(page);
  const turbo = page.locator("#turbo");
  await turbo.click();
  await expect(turbo).toHaveAttribute("aria-pressed", "true");
  await expect(turbo).toHaveText("Detener turbo");
  await expect.poll(() => generation(page), { timeout: 30_000 }).toBeGreaterThan(before);
  await turbo.click();
  await expect(turbo).toHaveAttribute("aria-pressed", "false");
  await expect(turbo).toHaveText("Turbo");
  await expect(page.locator("#toast")).toContainText("Turbo:");
  expect(errors).toEqual([]);
});

test("vista 3D", async ({ page }) => {
  const errors = await open(page);
  const button = page.locator("#view3d");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#world3d")).toBeVisible();
  await page.waitForTimeout(1500); // unos fotogramas en 3D
  // Si no hubiera WebGL o three.js fallara, un aviso diría que se usa la vista aérea.
  await expect(page.locator("#toast")).not.toContainText("vista 3D realista");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#world3d")).toBeHidden();
  expect(errors).toEqual([]);
});

test("guardar un mapa y abrirlo en Mis mapas", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#mode-edit").click();
  await page.locator("#toggle-maps").click();
  await expect(page.locator("#maps")).toBeVisible();
  await page.locator("#map-name").fill("Prueba E2E");
  await page.locator("#save-form button[type=submit]").click();
  await expect(page.locator("#toast")).toContainText("Prueba E2E");
  const item = page.locator(".map-item", { hasText: "Prueba E2E" });
  await expect(item).toHaveCount(1);
  await item.getByRole("button", { name: "Abrir" }).click();
  await expect(page.locator("#toast")).toContainText("abierto");
  // Sigue guardado al recargar.
  await page.reload();
  await page.locator("#mode-edit").click();
  await page.locator("#toggle-maps").click();
  await expect(page.locator(".map-item", { hasText: "Prueba E2E" })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Conducir", async ({ page, isMobile }) => {
  const errors = await open(page);
  const drive = page.locator("#drive");
  await drive.click();
  await expect(drive).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stat-you")).toBeVisible();
  await expect(page.locator("#turbo")).toBeDisabled();
  if (isMobile) {
    await expect(page.locator("#pad")).toBeVisible();
  } else {
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(800);
    await page.keyboard.up("ArrowUp");
  }
  await drive.click();
  await expect(drive).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stat-you")).toBeHidden();
  expect(errors).toEqual([]);
});

test("sin scroll horizontal a 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  for (const mode of ["#mode-train", "#mode-edit"]) {
    await page.locator(mode).click();
    if (mode === "#mode-edit") await page.locator("#toggle-maps").click();
    const widths = await page.evaluate(() =>
      ["html", "body", ".app", ".hud", ".dock"].map((sel) => {
        const el = document.querySelector(sel);
        return { sel, scroll: el.scrollWidth, client: el.clientWidth };
      })
    );
    for (const { sel, scroll, client } of widths) expect(scroll, `${mode} ${sel}`).toBeLessThanOrEqual(client);
  }
  expect(errors).toEqual([]);
});

test("abrir index.html desde el disco (file://) y entrenar", async ({ page }) => {
  const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
  const errors = await open(page, url);
  const before = await generation(page);
  await page.locator("#next").click();
  await expect.poll(() => generation(page)).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
