"use strict";
// Grafo del mapa: puntos (cruces y curvas) unidos por tramos de carretera.
// Los tramos guardan referencias a los propios objetos punto, así mover un punto
// arrastra todos los tramos que salen de él.

class Graph {
  constructor(points = [], segments = []) {
    this.points = points;
    this.segments = segments;
  }

  static fromJSON(data) {
    const points = data.points.map(([x, y]) => ({ x, y }));
    const segments = data.segments.map(([i, j]) => ({ a: points[i], b: points[j] }));
    return new Graph(points, segments);
  }

  toJSON() {
    const index = new Map(this.points.map((p, i) => [p, i]));
    return {
      points: this.points.map((p) => [Math.round(p.x), Math.round(p.y)]),
      segments: this.segments.map((s) => [index.get(s.a), index.get(s.b)]),
    };
  }

  addPoint(p) {
    this.points.push(p);
    return p;
  }

  hasSegment(a, b) {
    return this.segments.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a));
  }

  addSegment(a, b) {
    if (a === b || this.hasSegment(a, b)) return false;
    this.segments.push({ a, b });
    return true;
  }

  removeSegment(segment) {
    this.segments.splice(this.segments.indexOf(segment), 1);
  }

  removePoint(p) {
    this.segments = this.segments.filter((s) => s.a !== p && s.b !== p);
    this.points.splice(this.points.indexOf(p), 1);
  }

  // Quita los puntos que se quedaron sin ningún tramo, salvo el indicado.
  removeOrphans(keep = null) {
    const used = new Set();
    for (const s of this.segments) used.add(s.a).add(s.b);
    this.points = this.points.filter((p) => p === keep || used.has(p));
  }

  degree(p) {
    let n = 0;
    for (const s of this.segments) if (s.a === p || s.b === p) n++;
    return n;
  }

  nearestPoint(loc, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const p of this.points) {
      const d = distance(p, loc);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  nearestSegment(loc, maxDist) {
    let best = null;
    for (const segment of this.segments) {
      const proj = projectOnSegment(loc, segment.a, segment.b);
      if (proj.dist < maxDist && (!best || proj.dist < best.dist)) best = { segment, ...proj };
    }
    return best;
  }

  // Parte un tramo en dos con un punto nuevo; sirve para crear cruces.
  splitSegment(segment, at) {
    const p = this.addPoint({ x: at.x, y: at.y });
    this.removeSegment(segment);
    this.addSegment(segment.a, p);
    this.addSegment(p, segment.b);
    return p;
  }

  clear() {
    this.points = [];
    this.segments = [];
  }
}
