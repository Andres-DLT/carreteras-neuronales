// @ts-check
// App instalable y sin conexión: manifest, íconos, service worker y modo sin red.
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

const generation = async (page) => Number(await page.locator("#s-gen").textContent());

test("el manifest y los íconos responden 200", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.name).toBe("Carreteras Neuronales");
  expect(manifest.display).toBe("standalone");
  const icons = [
    ...manifest.icons.map((/** @type {{ src: string }} */ i) => i.src),
    "icons/apple-touch-icon.png",
    "icons/favicon.svg",
    "icons/favicon-32.png",
  ];
  for (const src of icons) {
    const icon = await request.get(`/${src}`);
    expect(icon.status(), src).toBe(200);
  }
});

test("sin conexión: recarga, entrena y abre el 3D", async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator("#s-gen")).toHaveText(/^\d+$/);
  // El service worker queda activo y controla la página (ya guardó todo al instalarse).
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const state = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state);
  expect(state).toBe("activated");

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#s-gen")).toHaveText(/^\d+$/);
  const before = await generation(page);
  await page.locator("#next").click();
  await expect.poll(() => generation(page)).toBeGreaterThan(before);

  await page.locator("#view3d").click();
  await expect(page.locator("#world3d")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator("#toast")).not.toContainText("vista 3D realista");
  // Las fuentes del juego también vienen de la caché.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
  });
  expect(fonts).toContain("Overpass");
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

// Servidor propio para esta prueba: sirve el proyecto, pero el VERSION de sw.js lo
// decide la prueba (así se puede "publicar" una versión nueva a mitad de la prueba).
async function versionedServer() {
  const root = path.join(__dirname, "..");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const state = { version: "dev" };
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url || "/", "http://x").pathname);
    if (file.endsWith("/")) file += "index.html";
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full)) return res.writeHead(404).end();
    let body = fs.readFileSync(full);
    if (file === "/sw.js") body = Buffer.from(body.toString("utf8").replace('const VERSION = "dev"', `const VERSION = "${state.version}"`));
    res.writeHead(200, { "Content-Type": types[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(undefined)));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/`, state, close: () => new Promise((ok) => server.close(() => ok(undefined))) };
}

test("una versión nueva avisa y recarga al aceptar", async ({ page }) => {
  const errors = watchErrors(page);
  const server = await versionedServer();
  test.info().attach("servidor", { body: server.url });
  await page.goto(server.url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator("#update")).toBeHidden();

  // Se publica otra versión: el mismo sw.js con otro VERSION.
  server.state.version = "e2e";
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
  await expect(page.locator("#update")).toBeVisible();

  await Promise.all([page.waitForEvent("load"), page.locator("#update-reload").click()]);
  await expect(page.locator("#s-gen")).toHaveText(/^\d+$/);
  await expect(page.locator("#update")).toBeHidden();
  // La caché vieja se borró al activarse la nueva.
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(["carreteras-neuronales-e2e"]);
  await server.close();
  expect(errors).toEqual([]);
});

test("Ajustes explica cómo instalar la app", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.locator("#toggle-settings").click();
  await expect(page.locator("#install-help")).toBeVisible();
  await expect(page.locator("#install-help")).not.toBeEmpty();
  await expect(page.locator("#update")).toBeHidden();
  expect(errors).toEqual([]);
});
