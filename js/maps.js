"use strict";
// Plantillas de mapa y generador de ciudades al azar. Todas devuelven el mismo
// formato que se guarda y se exporta: { points: [[x, y]], segments: [[i, j, tipo?]], start }.

const roundPts = (pts) => pts.map(([x, y]) => [Math.round(x), Math.round(y)]);

// Bucle de esquinas redondeadas recorrido en sentido horario (en pantalla), desde la
// esquina superior izquierda, con un punto en el centro de cada lado.
function roundedLoop(w, h, r, steps = 6) {
  const pts = [];
  const arc = (cx, cy, from) => {
    for (let i = 0; i <= steps; i++) {
      const t = from + (i / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
  };
  arc(-w + r, -h + r, Math.PI);
  pts.push([0, -h]);
  arc(w - r, -h + r, -Math.PI / 2);
  pts.push([w, 0]);
  arc(w - r, h - r, 0);
  pts.push([0, h]);
  arc(-w + r, h - r, Math.PI / 2);
  pts.push([-w, 0]);
  return roundPts(pts);
}

// Ayudante para construir mapas a mano.
function mapBuilder() {
  const points = [];
  const segments = [];
  const find = (x, y) => points.findIndex(([px, py]) => px === Math.round(x) && py === Math.round(y));
  const add = (x, y) => {
    const found = find(x, y);
    return found >= 0 ? found : points.push([Math.round(x), Math.round(y)]) - 1;
  };
  const link = (i, j, type) => segments.push(type && type !== "normal" ? [i, j, type] : [i, j]);
  const chain = (ids, type, closed = false) => {
    for (let k = 0; k < ids.length - 1; k++) link(ids[k], ids[k + 1], type);
    if (closed) link(ids[ids.length - 1], ids[0], type);
  };
  return { points, segments, add, find, link, chain };
}

// Circuito: esquinas redondeadas, un lado ondulado y una cruz central.
// La salida está antes de una curva y lejos de los semáforos: así lo primero
// que aprenden es a girar, y después a respetar los cruces.
function defaultMapData() {
  const m = mapBuilder();
  const loop = roundedLoop(700, 450, 250).filter(([x, y]) => !(x === -700 && y === 0));
  const ids = [];
  for (const [x, y] of loop) {
    ids.push(m.add(x, y));
    // El lado izquierdo es ondulado en vez de recto.
    if (x === -700 && y === 200) ids.push(m.add(-660, 110), m.add(-740, 0), m.add(-660, -110));
  }
  m.chain(ids, "normal", true);
  const center = m.add(0, 0);
  m.chain([m.find(0, -450), m.add(50, -225), center, m.add(-50, 225), m.find(0, 450)]);
  m.chain([m.find(-740, 0), m.add(-370, 35), center, m.add(350, -35), m.find(700, 0)]);
  return { points: m.points, segments: m.segments, start: { x: -250, y: 450, angle: Math.PI } };
}

// Cuadrícula: 4 × 3 calles rectas con muchos cruces en T y en X.
function gridMapData() {
  const m = mapBuilder();
  const xs = [-700, -233, 233, 700];
  const ys = [-450, 0, 450];
  ys.forEach((y, j) =>
    xs.forEach((x, i) => {
      if (i + 1 < xs.length) m.link(m.add(x, y), m.add(xs[i + 1], y));
      if (j + 1 < ys.length) m.link(m.add(x, y), m.add(x, ys[j + 1]));
    })
  );
  return { points: m.points, segments: m.segments, start: { x: -520, y: 450, angle: 0 } };
}

// Glorieta: rotonda central de un solo sentido (antihoraria) con cuatro brazos
// que llegan a un circuito exterior. En la glorieta no hay semáforos: hay que ceder.
function roundaboutMapData() {
  const m = mapBuilder();
  const RING = 170;
  const N = 12;
  const ring = [];
  for (let k = 0; k < N; k++) {
    const t = (k / N) * Math.PI * 2;
    ring.push(m.add(Math.cos(t) * RING, Math.sin(t) * RING));
  }
  for (let k = 0; k < N; k++) m.link(ring[k], ring[(k - 1 + N) % N], "glorieta");
  const S = 760;
  m.chain(roundedLoop(S, S, 300).map(([x, y]) => m.add(x, y)), "normal", true);
  // Brazos con una ligera curva para que no sean líneas rectas.
  m.chain([ring[0], m.add(460, 40), m.find(S, 0)]);
  m.chain([ring[3], m.add(-40, 460), m.find(0, S)]);
  m.chain([ring[6], m.add(-460, -40), m.find(-S, 0)]);
  m.chain([ring[9], m.add(40, -460), m.find(0, -S)]);
  return { points: m.points, segments: m.segments, start: { x: -380, y: S, angle: Math.PI } };
}

// Montaña: carretera en zigzag con cuatro rectas onduladas, curvas de herradura y
// un puente que baja en línea recta por encima de las rectas del medio.
function mountainMapData() {
  const m = mapBuilder();
  const ys = [-480, -160, 160, 480];
  const xs = [-500, -250, 0, 250, 500];
  const run = (y, reverse) => {
    const pts = xs.map((x, k) => [x, y + (k === 0 || k === 4 || k === 2 ? 0 : k % 2 ? 35 : -35)]);
    return (reverse ? pts.reverse() : pts).map(([x, yy]) => m.add(x, yy));
  };
  const hairpin = (cx, cy, from, to) => {
    const ids = [];
    for (let i = 1; i < 6; i++) {
      const t = from + (i / 6) * (to - from);
      ids.push(m.add(cx + Math.cos(t) * 160, cy + Math.sin(t) * 160));
    }
    return ids;
  };
  const path = [
    ...run(ys[0], false),
    ...hairpin(500, -320, -Math.PI / 2, Math.PI / 2),
    ...run(ys[1], true),
    ...hairpin(-500, 0, -Math.PI / 2, -1.5 * Math.PI),
    ...run(ys[2], false),
    ...hairpin(500, 320, -Math.PI / 2, Math.PI / 2),
    ...run(ys[3], true),
  ];
  // Vuelta por la izquierda, con esquinas redondeadas, para cerrar el circuito.
  const corner = (cx, cy, from, to) => {
    const ids = [];
    for (let i = 1; i < 5; i++) {
      const t = from + (i / 5) * (to - from);
      ids.push(m.add(cx + Math.cos(t) * 200, cy + Math.sin(t) * 200));
    }
    return ids;
  };
  path.push(m.add(-700, 480), ...corner(-700, 280, Math.PI / 2, Math.PI), m.add(-900, 280));
  path.push(m.add(-900, 0), m.add(-900, -280), ...corner(-700, -280, Math.PI, 1.5 * Math.PI), m.add(-700, -480));
  m.chain(path, "normal", true);
  m.link(m.find(0, -480), m.find(0, 480), "puente");
  return { points: m.points, segments: m.segments, start: { x: -900, y: 140, angle: -Math.PI / 2 } };
}

// Ciudad grande: 5 × 4 calles con una avenida, dos calles de sentido único en
// direcciones opuestas y un puente en diagonal que cruza toda la ciudad por encima.
function bigCityMapData() {
  const m = mapBuilder();
  const xs = [-900, -450, 0, 450, 900];
  const ys = [-650, -217, 217, 650];
  ys.forEach((y, j) =>
    xs.forEach((x, i) => {
      if (i + 1 < xs.length) m.link(m.add(x, y), m.add(xs[i + 1], y), j === 1 ? "avenida" : "normal");
      if (j + 1 < ys.length) {
        const a = m.add(x, y);
        const b = m.add(x, ys[j + 1]);
        if (i === 1) m.link(a, b, "unico"); // baja
        else if (i === 3) m.link(b, a, "unico"); // sube
        else m.link(a, b);
      }
    })
  );
  m.link(m.find(-900, 650), m.find(900, -650), "puente");
  return { points: m.points, segments: m.segments, start: { x: -675, y: 650, angle: 0 } };
}

// ---------- Ciudad al azar ----------
// Cuadrícula deformada a la que se le quitan calles, se le doblan algunas y se le
// añaden (según la semilla) una avenida, calles de sentido único, una glorieta y un puente.
function randomCityData(seed = Math.floor(Math.random() * 1e9)) {
  const rng = seededRandom(seed);
  const between = (a, b) => a + rng() * (b - a);
  const cols = 4 + Math.floor(rng() * 3);
  const rows = 3 + Math.floor(rng() * 2);
  const gap = between(400, 500);
  const points = [];
  const id = (i, j) => j * cols + i;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const edge = i === 0 || j === 0 || i === cols - 1 || j === rows - 1;
      const jitter = gap * (edge ? 0.06 : 0.14);
      points.push([
        (i - (cols - 1) / 2) * gap + between(-jitter, jitter),
        (j - (rows - 1) / 2) * gap + between(-jitter, jitter),
      ]);
    }
  }
  let segments = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (i + 1 < cols) segments.push([id(i, j), id(i + 1, j)]);
      if (j + 1 < rows) segments.push([id(i, j), id(i, j + 1)]);
    }
  }
  const degree = (p, segs = segments) => segs.filter((s) => s[0] === p || s[1] === p).length;
  const connected = (segs) => {
    const used = new Set(segs.flatMap((s) => [s[0], s[1]]));
    const start = segs[0][0];
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const p = queue.pop();
      for (const s of segs) {
        const q = s[0] === p ? s[1] : s[1] === p ? s[0] : null;
        if (q !== null && !seen.has(q)) {
          seen.add(q);
          queue.push(q);
        }
      }
    }
    return seen.size === used.size;
  };

  // Quita algunas calles interiores sin dejar callejones sin salida ni zonas aisladas.
  const order = segments.map((_, k) => k).sort(() => rng() - 0.5);
  let removed = 0;
  for (const k of order) {
    if (removed >= Math.floor(segments.length * 0.18)) break;
    const s = segments[k];
    if (!s) continue;
    const rest = segments.filter((t) => t !== s && t);
    if (degree(s[0], rest) < 2 || degree(s[1], rest) < 2 || !connected(rest)) continue;
    segments[k] = null;
    removed++;
  }
  segments = segments.filter(Boolean);

  // Una avenida a lo largo de una fila completa (si sigue entera).
  if (rng() < 0.6) {
    const row = 1 + Math.floor(rng() * (rows - 2));
    for (const s of segments) {
      const [a, b] = s;
      if (Math.floor(a / cols) === row && Math.floor(b / cols) === row) s[2] = "avenida";
    }
  }
  // Una o dos columnas interiores de sentido único, en direcciones opuestas.
  const oneways = rng() < 0.7 ? 1 + Math.floor(rng() * 2) : 0;
  for (let c = 0; c < oneways; c++) {
    const col = 1 + Math.floor(rng() * (cols - 2));
    const down = c % 2 === 0;
    for (const s of segments) {
      if (s[2] || s[0] % cols !== col || s[1] % cols !== col) continue;
      s[2] = "unico";
      const [a, b] = s;
      if (down !== a < b) {
        s[0] = b;
        s[1] = a;
      }
    }
  }

  // Curvas: algunas calles normales se doblan por la mitad.
  const bent = [];
  for (const s of segments) {
    const [a, b, type] = s;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    if (type || len < 320 || rng() > 0.3) {
      bent.push(s);
      continue;
    }
    const off = between(40, 85) * (rng() < 0.5 ? -1 : 1);
    const mid = points.push([(ax + bx) / 2 - ((by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off]) - 1;
    bent.push([a, mid], [mid, b]);
  }
  segments = bent;

  // Glorieta en lugar de un cruce interior de cuatro calles.
  if (rng() < 0.5) {
    const candidates = points
      .map((_, p) => p)
      .filter((p) => degree(p) === 4 && segments.every((s) => (s[0] !== p && s[1] !== p) || !s[2]));
    if (candidates.length) {
      const c = candidates[Math.floor(rng() * candidates.length)];
      const [cx, cy] = points[c];
      const ring = [];
      for (let k = 0; k < 8; k++) {
        const t = (k / 8) * Math.PI * 2;
        ring.push(points.push([cx + Math.cos(t) * 140, cy + Math.sin(t) * 140]) - 1);
      }
      for (const s of segments) {
        const end = s[0] === c ? 0 : s[1] === c ? 1 : -1;
        if (end < 0) continue;
        const [ox, oy] = points[s[1 - end]];
        const k = ((Math.round(Math.atan2(oy - cy, ox - cx) / (Math.PI / 4)) % 8) + 8) % 8;
        s[end] = ring[k];
      }
      for (let k = 0; k < 8; k++) segments.push([ring[k], ring[(k + 7) % 8], "glorieta"]);
    }
  }

  // Puente recto entre dos bordes opuestos, que no pase cerca de ningún cruce.
  if (rng() < 0.5) {
    const border = points.map((_, p) => p).filter((p) => p < cols * rows && degree(p) > 0 && degree(p) < 4);
    for (let tries = 0; tries < 30; tries++) {
      const a = border[Math.floor(rng() * border.length)];
      const b = border[Math.floor(rng() * border.length)];
      const A = { x: points[a][0], y: points[a][1] };
      const B = { x: points[b][0], y: points[b][1] };
      if (a === b || distance(A, B) < gap * 2.2) continue;
      const clear = points.every(
        ([x, y], p) => p === a || p === b || degree(p) === 0 || projectOnSegment({ x, y }, A, B).dist > 150
      );
      if (clear) {
        segments.push([a, b, "puente"]);
        break;
      }
    }
  }

  // Quita puntos sin tramos y renumera.
  const used = [...new Set(segments.flatMap((s) => [s[0], s[1]]))].sort((p, q) => p - q);
  const remap = new Map(used.map((p, k) => [p, k]));
  const finalPoints = roundPts(used.map((p) => points[p]));
  const finalSegments = segments.map(([a, b, type]) => (type ? [remap.get(a), remap.get(b), type] : [remap.get(a), remap.get(b)]));

  // Salida en una calle normal y larga del borde.
  const pt = (k) => ({ x: finalPoints[k][0], y: finalPoints[k][1] });
  const box = boundsOf(finalPoints.map(([x, y]) => ({ x, y })));
  const candidates = finalSegments
    .filter((s) => !s[2] && distance(pt(s[0]), pt(s[1])) > 300)
    .map((s) => ({ s, edge: Math.min(...[pt(s[0]), pt(s[1])].map((p) => Math.min(p.x - box.minX, box.maxX - p.x, p.y - box.minY, box.maxY - p.y))) }))
    .sort((p, q) => p.edge - q.edge);
  const chosen = (candidates[0] || { s: finalSegments[0] }).s;
  const A = pt(chosen[0]);
  const B = pt(chosen[1]);
  const startPoint = lerpPoint(A, B, 0.35);
  return {
    points: finalPoints,
    segments: finalSegments,
    start: { x: Math.round(startPoint.x), y: Math.round(startPoint.y), angle: Math.atan2(B.y - A.y, B.x - A.x) },
    seed,
  };
}

const MAP_TEMPLATES = {
  circuito: { name: "Circuito", build: defaultMapData },
  cuadricula: { name: "Cuadrícula", build: gridMapData },
  glorieta: { name: "Glorieta", build: roundaboutMapData },
  montana: { name: "Montaña", build: mountainMapData },
  ciudad: { name: "Ciudad grande", build: bigCityMapData },
};
