// Genera los íconos de la app a partir de icons/icon.svg con Playwright (Chromium):
//   node scripts/make-icons.mjs
// icon-192.png e icon-512.png (letrero con esquinas redondeadas), icon-maskable-512.png
// (fondo a sangre y el dibujo dentro de la zona segura), apple-touch-icon.png (180, a
// sangre: iOS redondea las esquinas) y favicon-32.png. favicon.svg es el propio icon.svg.
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const dir = fileURLToPath(new URL("../icons/", import.meta.url));
const svg = await readFile(join(dir, "icon.svg"), "utf8");
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// A sangre: fondo verde cuadrado y el letrero reducido al centro. `scale` deja el
// dibujo dentro de la zona segura de los íconos adaptables (un círculo del 80 %).
const fullBleed = (scale) => {
  const offset = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0a6a3b"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g>
</svg>`;
};

const OUTPUTS = [
  { file: "icon-192.png", size: 192, svg },
  { file: "icon-512.png", size: 512, svg },
  { file: "icon-maskable-512.png", size: 512, svg: fullBleed(0.72) },
  { file: "apple-touch-icon.png", size: 180, svg: fullBleed(0.86) },
  { file: "favicon-32.png", size: 32, svg },
];

const browser = await chromium.launch();
for (const { file, size, svg: source } of OUTPUTS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const url = "data:image/svg+xml;base64," + Buffer.from(source).toString("base64");
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${url}">`
  );
  await page.locator("img").evaluate((img) => img.decode());
  await writeFile(join(dir, file), await page.screenshot({ omitBackground: true }));
  await page.close();
  console.log(`icons/${file} (${size} px)`);
}
await browser.close();
await copyFile(join(dir, "icon.svg"), join(dir, "favicon.svg"));
console.log("icons/favicon.svg");
