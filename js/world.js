"use strict";
// El mundo: el grafo convertido en carreteras con asfalto, línea central y bordes.
// Cada tramo se envuelve en un polígono redondeado; la unión de todos esos
// polígonos da los bordes contra los que chocan los coches.

const ROAD_WIDTH = 100; // ≈ 9.4 m: dos carriles
const ROAD_ROUNDNESS = 10; // lados por media circunferencia en cada extremo

function roadEnvelope(a, b, width = ROAD_WIDTH, roundness = ROAD_ROUNDNESS) {
  const r = width / 2;
  const alpha = Math.atan2(b.y - a.y, b.x - a.x);
  const points = [];
  for (let i = 0; i <= roundness; i++) {
    const t = alpha - Math.PI / 2 + (i / roundness) * Math.PI;
    points.push({ x: b.x + Math.cos(t) * r, y: b.y + Math.sin(t) * r });
  }
  for (let i = 0; i <= roundness; i++) {
    const t = alpha + Math.PI / 2 + (i / roundness) * Math.PI;
    points.push({ x: a.x + Math.cos(t) * r, y: a.y + Math.sin(t) * r });
  }
  return points;
}

// Contorno de la unión: trocea cada lado donde corta a otros polígonos y
// conserva solo los trozos que no quedan dentro de ningún otro.
function roadBorders(polygons) {
  const boxes = polygons.map(boundsOf);
  const borders = [];
  polygons.forEach((poly, i) => {
    for (let k = 0; k < poly.length; k++) {
      const A = poly[k];
      const B = poly[(k + 1) % poly.length];
      const edgeBox = boundsOf([A, B]);
      const cuts = [0, 1];
      polygons.forEach((other, j) => {
        if (j === i || !boundsOverlap(edgeBox, boxes[j])) return;
        for (let m = 0; m < other.length; m++) {
          const hit = getIntersection(A, B, other[m], other[(m + 1) % other.length]);
          if (hit) cuts.push(hit.offset);
        }
      });
      cuts.sort((p, q) => p - q);
      for (let c = 0; c < cuts.length - 1; c++) {
        if (cuts[c + 1] - cuts[c] < 1e-6) continue;
        const mid = lerpPoint(A, B, (cuts[c] + cuts[c + 1]) / 2);
        const covered = polygons.some(
          (other, j) => j !== i && insideBounds(mid, boxes[j]) && pointInPolygon(mid, other)
        );
        if (!covered) borders.push([lerpPoint(A, B, cuts[c]), lerpPoint(A, B, cuts[c + 1])]);
      }
    }
  });
  return borders;
}

// Rejilla espacial: cada coche consulta solo los bordes cercanos.
class SegmentGrid {
  constructor(segments, cell = 120) {
    this.cell = cell;
    this.segments = segments;
    this.cells = new Map();
    this.marks = new Uint32Array(segments.length);
    this.stamp = 0;
    segments.forEach(([a, b], i) => {
      const x0 = Math.floor(Math.min(a.x, b.x) / cell);
      const x1 = Math.floor(Math.max(a.x, b.x) / cell);
      const y0 = Math.floor(Math.min(a.y, b.y) / cell);
      const y1 = Math.floor(Math.max(a.y, b.y) / cell);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = SegmentGrid.key(x, y);
          if (!this.cells.has(key)) this.cells.set(key, []);
          this.cells.get(key).push(i);
        }
      }
    });
  }

  static key(x, y) {
    return (x + 32768) * 65536 + (y + 32768);
  }

  query(minX, minY, maxX, maxY, out = []) {
    out.length = 0;
    this.stamp++;
    const x0 = Math.floor(minX / this.cell);
    const x1 = Math.floor(maxX / this.cell);
    const y0 = Math.floor(minY / this.cell);
    const y1 = Math.floor(maxY / this.cell);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = this.cells.get(SegmentGrid.key(x, y));
        if (!list) continue;
        for (const i of list) {
          if (this.marks[i] === this.stamp) continue;
          this.marks[i] = this.stamp;
          out.push(this.segments[i]);
        }
      }
    }
    return out;
  }
}

class World {
  constructor(graph, start) {
    this.graph = graph;
    this.start = { ...start };
    this.generate();
  }

  generate() {
    this.envelopes = this.graph.segments.map((s) => roadEnvelope(s.a, s.b));
    this.borders = roadBorders(this.envelopes);
    this.grid = new SegmentGrid(this.borders);
    this.degrees = new Map(this.graph.points.map((p) => [p, this.graph.degree(p)]));
  }

  isOnRoad(p) {
    return this.envelopes.some((e) => pointInPolygon(p, e));
  }

  // Si la salida quedó fuera del asfalto, la lleva al centro del primer tramo.
  ensureStart() {
    if (!this.graph.segments.length || this.isOnRoad(this.start)) return;
    const { a, b } = this.graph.segments[0];
    this.start = { ...lerpPoint(a, b, 0.5), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  draw(ctx, colors) {
    ctx.fillStyle = colors.road;
    for (const envelope of this.envelopes) {
      ctx.beginPath();
      envelope.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    }

    // Línea central discontinua; se corta en los cruces para no pintar sobre ellos.
    ctx.strokeStyle = colors.lane;
    ctx.lineWidth = 4;
    ctx.lineCap = "butt";
    ctx.setLineDash([24, 20]);
    ctx.beginPath();
    for (const { a, b } of this.graph.segments) {
      const length = distance(a, b);
      const trimA = (this.degrees.get(a) || 0) > 2 ? ROAD_WIDTH / 2 : 0;
      const trimB = (this.degrees.get(b) || 0) > 2 ? ROAD_WIDTH / 2 : 0;
      if (length <= trimA + trimB + 12) continue;
      const p = lerpPoint(a, b, trimA / length);
      const q = lerpPoint(a, b, 1 - trimB / length);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [p, q] of this.borders) {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
}

// Mapa de ejemplo: un circuito con esquinas redondeadas, un lado ondulado y una
// cruz en el centro que crea cuatro manzanas y varios cruces.
function defaultMapData() {
  const R = 250;
  const loop = [];
  const arc = (cx, cy, from) => {
    for (let i = 0; i <= 6; i++) {
      const t = from + (i / 6) * (Math.PI / 2);
      loop.push([cx + Math.cos(t) * R, cy + Math.sin(t) * R]);
    }
  };
  arc(-450, -200, Math.PI); // esquina superior izquierda
  loop.push([0, -450]);
  arc(450, -200, -Math.PI / 2); // superior derecha
  loop.push([700, 0]);
  arc(450, 200, 0); // inferior derecha
  loop.push([0, 450]);
  arc(-450, 200, Math.PI / 2); // inferior izquierda
  loop.push([-660, 110], [-740, 0], [-660, -110]);

  const points = loop.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const segments = points.map((_, i) => [i, (i + 1) % points.length]);
  const find = (x, y) => points.findIndex(([px, py]) => px === x && py === y);
  const extra = (x, y) => points.push([x, y]) - 1;
  const chain = (...ids) => ids.slice(1).forEach((id, k) => segments.push([ids[k], id]));

  const center = extra(0, 0);
  chain(find(0, -450), extra(50, -225), center, extra(-50, 225), find(0, 450));
  chain(find(-740, 0), extra(-370, 35), center, extra(350, -35), find(700, 0));

  return { points, segments, start: { x: 300, y: 450, angle: Math.PI } };
}
