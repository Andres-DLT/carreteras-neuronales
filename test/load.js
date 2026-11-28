"use strict";
// Carga los scripts clásicos del simulador en un mismo contexto `vm`, igual que
// hace js/worker.js con importScripts: comparten las declaraciones globales y no
// necesitan el DOM. Devuelve una función para leer cualquier nombre global.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SIM_SCRIPTS = ["math", "graph", "world", "network", "car", "traffic", "scenery", "maps", "real-maps", "sim"];

function load(scripts = SIM_SCRIPTS) {
  const context = vm.createContext({ console, performance: { now: () => Date.now() } });
  for (const name of scripts) {
    const file = path.join(__dirname, "..", "js", `${name}.js`);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }
  // `const` y `class` de nivel superior no son propiedades del objeto global:
  // se leen evaluando su nombre dentro del contexto.
  const get = (name) => vm.runInContext(name, context);
  return { context, get };
}

module.exports = { load, SIM_SCRIPTS };
