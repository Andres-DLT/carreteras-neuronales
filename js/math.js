"use strict";
// Utilidades geométricas compartidas por el mapa, el editor y los coches.
// Todas las posiciones son objetos {x, y} en unidades de mundo (píxeles a zoom 1).

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerpPoint = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Intersección de los segmentos AB y CD; offset es la fracción recorrida sobre AB.
function getIntersection(A, B, C, D) {
  const bottom = (D.y - C.y) * (B.x - A.x) - (D.x - C.x) * (B.y - A.y);
  if (Math.abs(bottom) < 1e-9) return null;
  const t = ((D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x)) / bottom;
  const u = ((C.y - A.y) * (A.x - B.x) - (C.x - A.x) * (A.y - B.y)) / bottom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t), offset: t };
}

// Regla par-impar: cuenta cuántos lados cruza un rayo horizontal desde p.
function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// Punto del segmento AB más cercano a p.
function projectOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1) : 0;
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, t, dist: distance(p, point) };
}

function boundsOf(points) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y > box.maxY) box.maxY = p.y;
  }
  return box;
}

const boundsOverlap = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const insideBounds = (p, box) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
