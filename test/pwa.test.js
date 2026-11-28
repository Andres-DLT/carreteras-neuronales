"use strict";
// El service worker tiene que guardar todo lo que carga el juego, o sin conexión
// faltaría algún archivo. Estas pruebas avisan si se añade un script y se olvida aquí.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadServiceWorker() {
  const context = vm.createContext({ self: { addEventListener() {}, location: { origin: "http://localhost" } } });
  vm.runInContext(read("sw.js"), context, { filename: "sw.js" });
  return { PRECACHE: vm.runInContext("PRECACHE", context), VERSION: vm.runInContext("VERSION", context) };
}

const { PRECACHE, VERSION } = loadServiceWorker();
const cached = new Set(PRECACHE);
const html = read("index.html");

test("pwa: en el código fuente VERSION es 'dev' (la publicación pone el commit)", () => {
  assert.equal(VERSION, "dev");
});

test("pwa: todo lo de la precarga existe y no hay repetidos", () => {
  assert.equal(cached.size, PRECACHE.length, "entradas repetidas en PRECACHE");
  for (const file of PRECACHE) {
    if (file === "./") continue;
    assert.ok(fs.existsSync(path.join(root, file)), `${file} no existe`);
  }
});

test("pwa: se guardan todos los scripts y estilos de index.html", () => {
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const local = refs.filter((r) => !/^[a-z]+:/i.test(r));
  assert.ok(local.length > 20);
  for (const ref of local) assert.ok(cached.has(ref), `${ref} no está en PRECACHE`);
});

test("pwa: no hay recursos de otros dominios en index.html", () => {
  const external = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external, []);
});

test("pwa: se guardan todos los archivos de js/ (también los del worker)", () => {
  const walk = (dir) =>
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []
    );
  for (const file of walk("js")) assert.ok(cached.has(file), `${file} no está en PRECACHE`);
  const imported = read("js/worker.js").match(/importScripts\(([^)]*)\)/)[1].match(/"([^"]+)"/g).map((s) => `js/${s.slice(1, -1)}`);
  for (const file of imported) assert.ok(cached.has(file), `${file} (del worker) no está en PRECACHE`);
  assert.ok(cached.has("vendor/three.min.js"));
});

test("pwa: se guardan las fuentes de fonts.css y los íconos del manifest", () => {
  for (const [, file] of read("fonts/fonts.css").matchAll(/url\("([^"]+)"\)/g)) {
    assert.ok(cached.has(`fonts/${file}`), `fonts/${file} no está en PRECACHE`);
  }
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith("/"), `${icon.src}: las rutas deben ser relativas`);
    assert.ok(cached.has(icon.src), `${icon.src} no está en PRECACHE`);
  }
});
