"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.js");

const { get } = load(["math"]);
const getIntersection = get("getIntersection");
const pointInPolygon = get("pointInPolygon");
const projectOnSegment = get("projectOnSegment");

const p = (x, y) => ({ x, y });

test("getIntersection: dos segmentos que se cruzan", () => {
  const hit = getIntersection(p(0, 0), p(10, 10), p(0, 10), p(10, 0));
  assert.ok(hit);
  assert.equal(hit.x, 5);
  assert.equal(hit.y, 5);
  assert.equal(hit.offset, 0.5);
});

test("getIntersection: el offset es la fracción recorrida sobre AB", () => {
  const hit = getIntersection(p(0, 0), p(100, 0), p(25, -10), p(25, 10));
  assert.ok(hit);
  assert.equal(hit.offset, 0.25);
  assert.equal(hit.x, 25);
  assert.equal(hit.y, 0);
});

test("getIntersection: paralelos o que no llegan a tocarse", () => {
  assert.equal(getIntersection(p(0, 0), p(10, 0), p(0, 5), p(10, 5)), null);
  assert.equal(getIntersection(p(0, 0), p(10, 0), p(0, 0), p(10, 0)), null);
  assert.equal(getIntersection(p(0, 0), p(4, 4), p(10, 0), p(6, 4)), null);
});

test("getIntersection: tocar en un extremo cuenta", () => {
  const hit = getIntersection(p(0, 0), p(10, 0), p(10, -5), p(10, 5));
  assert.ok(hit);
  assert.equal(hit.offset, 1);
});

test("pointInPolygon: cuadrado y polígono cóncavo", () => {
  const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
  assert.equal(pointInPolygon(p(5, 5), square), true);
  assert.equal(pointInPolygon(p(15, 5), square), false);
  assert.equal(pointInPolygon(p(-1, -1), square), false);

  // Una "U": el hueco del centro queda fuera.
  const u = [p(0, 0), p(30, 0), p(30, 30), p(20, 30), p(20, 10), p(10, 10), p(10, 30), p(0, 30)];
  assert.equal(pointInPolygon(p(5, 20), u), true);
  assert.equal(pointInPolygon(p(25, 20), u), true);
  assert.equal(pointInPolygon(p(15, 20), u), false);
  assert.equal(pointInPolygon(p(15, 5), u), true);
});

test("projectOnSegment: punto más cercano y distancia", () => {
  const proj = projectOnSegment(p(5, 3), p(0, 0), p(10, 0));
  assert.equal(proj.point.x, 5);
  assert.equal(proj.point.y, 0);
  assert.equal(proj.t, 0.5);
  assert.equal(proj.dist, 3);
  // Fuera del segmento se queda en el extremo.
  assert.equal(projectOnSegment(p(-4, 3), p(0, 0), p(10, 0)).dist, 5);
});
