"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.js");

const { get } = load();
const Graph = get("Graph");
const World = get("World");
const MAP_TEMPLATES = get("MAP_TEMPLATES");
const REAL_MAPS = get("REAL_MAPS");
const randomCityData = get("randomCityData");

function buildWorld(data) {
  const world = new World(Graph.fromJSON(data), data.start, data.goal);
  world.ensureStart();
  return world;
}

function assertPlayable(world, label) {
  assert.ok(world.graph.segments.length > 0, `${label}: sin tramos`);
  assert.ok(world.borders.length > 0, `${label}: sin bordes`);
  assert.ok(world.cellCapacity > 1, `${label}: sin celdas de calle`);
  assert.ok(world.isOnRoad(world.start), `${label}: la salida no está sobre la calle`);
  assert.ok(Number.isFinite(world.start.angle), `${label}: la salida no tiene sentido`);
}

test("todas las plantillas construyen un World", () => {
  for (const [key, template] of Object.entries(MAP_TEMPLATES)) {
    assertPlayable(buildWorld(template.build()), key);
  }
});

test("todos los barrios reales construyen un World y están entre las plantillas", () => {
  const keys = Object.keys(REAL_MAPS);
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.ok(MAP_TEMPLATES[key], `${key} no aparece en MAP_TEMPLATES`);
    assertPlayable(buildWorld(REAL_MAPS[key].data), key);
  }
});

test("las ciudades al azar construyen un World y la semilla las repite", () => {
  for (const seed of [1, 7, 20261028]) {
    const a = randomCityData(seed);
    assertPlayable(buildWorld(a), `ciudad ${seed}`);
    assert.equal(JSON.stringify(randomCityData(seed)), JSON.stringify(a), `ciudad ${seed} no se repite`);
  }
});

test("hay ruta hacia un destino en las plantillas", () => {
  for (const key of ["circuito", "cuadricula", "ciudad"]) {
    const route = buildWorld(MAP_TEMPLATES[key].build()).route();
    assert.ok(route && route.length > 0, `${key}: sin ruta`);
  }
});
