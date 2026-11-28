"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.js");

const { get } = load();
const Graph = get("Graph");
const MAP_TEMPLATES = get("MAP_TEMPLATES");

// Los objetos nacen en otro contexto (otro Array.prototype): se comparan como JSON.
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

test("Graph: fromJSON → toJSON devuelve los mismos datos, con tipos", () => {
  const data = {
    points: [[0, 0], [300, 0], [300, 200], [0, 200]],
    segments: [[0, 1], [1, 2, "avenida"], [2, 3, "unico"], [3, 0, "puente"]],
  };
  same(Graph.fromJSON(data).toJSON(), data);
});

test("Graph: un tipo desconocido pasa a calle normal", () => {
  const g = Graph.fromJSON({ points: [[0, 0], [100, 0]], segments: [[0, 1, "autopista"]] });
  assert.equal(g.segments[0].type, "normal");
  same(g.toJSON().segments, [[0, 1]]);
});

test("Graph: los tramos apuntan a los mismos objetos punto", () => {
  const g = Graph.fromJSON({ points: [[0, 0], [100, 0], [100, 100]], segments: [[0, 1], [1, 2]] });
  assert.equal(g.segments[0].b, g.segments[1].a);
  assert.equal(g.degree(g.points[1]), 2);
});

test("Graph: ida y vuelta de todas las plantillas", () => {
  for (const [key, template] of Object.entries(MAP_TEMPLATES)) {
    const data = template.build();
    const json = Graph.fromJSON(data).toJSON();
    same(json.points, data.points.map(([x, y]) => [Math.round(x), Math.round(y)]));
    assert.equal(json.segments.length, data.segments.length, key);
    // Una segunda vuelta ya no cambia nada.
    same(Graph.fromJSON(json).toJSON(), json);
  }
});

test("Graph: splitSegment conserva el tipo en las dos mitades", () => {
  const g = Graph.fromJSON({ points: [[0, 0], [200, 0]], segments: [[0, 1, "unico"]] });
  const mid = g.splitSegment(g.segments[0], { x: 100, y: 0 });
  assert.equal(g.segments.length, 2);
  assert.ok(g.segments.every((s) => s.type === "unico"));
  assert.equal(g.degree(mid), 2);
});
