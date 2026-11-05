"use strict";
// El mundo: el grafo convertido en carreteras con asfalto, marcas viales y bordes.
// Cada tramo se envuelve en un polígono redondeado; la unión de todos esos
// polígonos da los bordes contra los que chocan los coches. Los puentes van en un
// nivel aparte: cruzan por encima de otras calles sin formar cruce.

const ROAD_WIDTH = 100; // ≈ 9.4 m: dos carriles (una avenida mide 160, cuatro carriles)
const ROAD_ROUNDNESS = 10; // lados por media circunferencia en cada extremo
const RAMP_LENGTH = ROAD_WIDTH; // tramo de cada puente que empalma a ras de suelo

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

const unitVector = (a, b) => {
  const len = distance(a, b) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
};

class World {
  constructor(graph, start) {
    this.graph = graph;
    this.start = { ...start };
    this.generate();
  }

  // scenery: false mientras se arrastra un punto, para no recolocar edificios
  // y árboles en cada movimiento; se recalculan al soltar.
  generate({ scenery = true } = {}) {
    const segments = this.graph.segments;
    this.envelopes = segments.map((s) => roadEnvelope(s.a, s.b, roadType(s).width));
    // Nivel del suelo: todos los tramos menos los puentes, más una rampa corta en
    // cada extremo de puente para que empalme con las calles a las que llega.
    this.groundEnvelopes = [];
    this.bridges = [];
    segments.forEach((s, i) => {
      if (s.type !== "puente") {
        this.groundEnvelopes.push(this.envelopes[i]);
        return;
      }
      const len = distance(s.a, s.b);
      const u = unitVector(s.a, s.b);
      const ramp = Math.min(RAMP_LENGTH, len / 2);
      this.groundEnvelopes.push(roadEnvelope(s.a, { x: s.a.x + u.x * ramp, y: s.a.y + u.y * ramp }));
      this.groundEnvelopes.push(roadEnvelope({ x: s.b.x - u.x * ramp, y: s.b.y - u.y * ramp }, s.b));
      const R = roadHalf(s);
      const side = (k) => {
        const seg = [
          { x: s.a.x - u.y * R * k, y: s.a.y + u.x * R * k },
          { x: s.b.x - u.y * R * k, y: s.b.y + u.x * R * k },
        ];
        seg.kind = "edge";
        return seg;
      };
      this.bridges.push({ segment: s, envelope: this.envelopes[i], u, len, sides: [side(1), side(-1)] });
    });
    this.borders = roadBorders(this.groundEnvelopes);
    this.grid = new SegmentGrid(this.borders);
    this.degrees = new Map(this.graph.points.map((p) => [p, this.graph.degree(p)]));
    // Medio ancho de la calle más ancha que llega a cada punto: marca dónde empieza el cruce.
    this.nodeHalf = new Map(this.graph.points.map((p) => [p, ROAD_WIDTH / 2]));
    for (const s of segments) {
      for (const p of [s.a, s.b]) this.nodeHalf.set(p, Math.max(this.nodeHalf.get(p), roadHalf(s)));
    }
    this.intersections = buildIntersections(this);
    this.crosswalks = buildCrosswalks(this);
    if (scenery || !this.scenery) this.scenery = generateScenery(this.graph);
  }

  isOnRoad(p) {
    return this.groundEnvelopes.some((e) => pointInPolygon(p, e));
  }

  // Si la salida quedó fuera del asfalto (o encima de un puente), la lleva al
  // centro del primer tramo a ras de suelo.
  ensureStart() {
    const onBridge = this.bridges.some((b) => pointInPolygon(this.start, b.envelope));
    if (!this.graph.segments.length || (this.isOnRoad(this.start) && !onBridge)) return;
    const s = this.graph.segments.find((seg) => seg.type !== "puente") || this.graph.segments[0];
    const angle = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    this.start = { ...lerpPoint(s.a, s.b, 0.5), angle };
  }

  // Calzada y marcas del nivel del suelo; los puentes se pintan aparte, encima
  // de los coches que pasan por debajo.
  draw(ctx, colors) {
    ctx.fillStyle = colors.road;
    for (const envelope of this.groundEnvelopes) fillPolygon(ctx, envelope);
    for (const s of this.graph.segments) if (s.type !== "puente") this.drawMarkings(ctx, colors, s);
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

  // Líneas de un tramo: discontinua central (calle y puente), doble continua y
  // carriles (avenida), o separador de carriles y flechas (sentido único y glorieta).
  // Se cortan al llegar a un cruce para no pintar sobre él.
  drawMarkings(ctx, colors, s) {
    const length = distance(s.a, s.b);
    const trimA = (this.degrees.get(s.a) || 0) > 2 ? this.nodeHalf.get(s.a) : 0;
    const trimB = (this.degrees.get(s.b) || 0) > 2 ? this.nodeHalf.get(s.b) : 0;
    if (length <= trimA + trimB + 12) return;
    const u = unitVector(s.a, s.b);
    const n = { x: -u.y, y: u.x };
    const line = (offset, dash, color, width = 4) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "butt";
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(s.a.x + u.x * trimA + n.x * offset, s.a.y + u.y * trimA + n.y * offset);
      ctx.lineTo(s.b.x - u.x * trimB + n.x * offset, s.b.y - u.y * trimB + n.y * offset);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const type = s.type || "normal";
    if (type === "avenida") {
      line(-4, [], colors.lane, 3);
      line(4, [], colors.lane, 3);
      line(-40, [18, 22], colors.edge, 3);
      line(40, [18, 22], colors.edge, 3);
    } else if (type === "unico" || type === "glorieta") {
      line(0, [18, 22], colors.edge, 3);
      // Flechas en ambos carriles, apuntando en el sentido de circulación.
      ctx.fillStyle = colors.edge;
      for (let t = trimA + 50; t < length - trimB - 40; t += 150) {
        for (const lane of [-25, 25]) {
          const c = { x: s.a.x + u.x * t + n.x * lane, y: s.a.y + u.y * t + n.y * lane };
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(Math.atan2(u.y, u.x));
          ctx.beginPath();
          ctx.moveTo(14, 0);
          ctx.lineTo(2, -8);
          ctx.lineTo(2, -3);
          ctx.lineTo(-14, -3);
          ctx.lineTo(-14, 3);
          ctx.lineTo(2, 3);
          ctx.lineTo(2, 8);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    } else {
      line(0, [24, 20], colors.lane);
    }
  }

  // Tablero del puente con su sombra y barandillas, pintado sobre lo que pasa debajo.
  drawBridges(ctx, colors) {
    for (const b of this.bridges) {
      ctx.fillStyle = colors.worldShadow;
      fillPolygon(ctx, b.envelope.map((p) => ({ x: p.x + 12, y: p.y + 14 })));
      ctx.fillStyle = colors.road;
      fillPolygon(ctx, b.envelope);
      this.drawMarkings(ctx, colors, b.segment);
      for (const [p, q] of b.sides) {
        ctx.lineCap = "round";
        ctx.strokeStyle = colors.node;
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        ctx.strokeStyle = colors.edge;
        ctx.lineWidth = 5;
        ctx.stroke();
      }
    }
  }
}

function fillPolygon(ctx, points) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
}
