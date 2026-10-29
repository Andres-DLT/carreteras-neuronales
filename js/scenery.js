"use strict";
// Paisaje: edificios alineados con las calles y árboles en los huecos libres.
// Es decorativo (los coches chocan antes con el bordillo) y se genera con una
// semilla sacada del propio mapa, así el mismo mapa siempre luce igual.

function mapSeed(graph) {
  let h = 2166136261;
  for (const p of graph.points) {
    h = Math.imul(h ^ Math.round(p.x), 16777619);
    h = Math.imul(h ^ Math.round(p.y), 16777619);
  }
  return (h ^ graph.segments.length) >>> 0;
}

function generateScenery(graph) {
  const segments = graph.segments;
  if (!segments.length) return { buildings: [], trees: [] };
  const rng = seededRandom(mapSeed(graph));
  const R = ROAD_WIDTH / 2;
  const clearOfRoads = (p, margin) => segments.every((s) => projectOnSegment(p, s.a, s.b).dist > R + margin);

  // Manzanas: rectángulos a ambos lados de cada tramo, de frente a la calle.
  const buildings = [];
  for (const { a, b } of segments) {
    const len = distance(a, b);
    if (len < 90) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    for (const side of [1, -1]) {
      for (let t = 45 + rng() * 30; t < len - 45; t += 115 + rng() * 45) {
        const w = 64 + rng() * 52; // fachada
        const d = 56 + rng() * 54; // fondo
        const off = (R + 22 + d / 2) * side;
        const c = { x: a.x + u.x * t + n.x * off, y: a.y + u.y * t + n.y * off };
        const corners = [
          [-w / 2, -d / 2],
          [w / 2, -d / 2],
          [w / 2, d / 2],
          [-w / 2, d / 2],
        ].map(([i, j]) => ({ x: c.x + u.x * i + n.x * j, y: c.y + u.y * i + n.y * j }));
        if (![c, ...corners].every((p) => clearOfRoads(p, 12))) continue;
        const radius = Math.hypot(w, d) / 2;
        if (buildings.some((o) => distance(o.c, c) < (o.radius + radius) * 0.82)) continue;
        buildings.push({ c, corners, u, w, d, radius, roof: Math.floor(rng() * 3), height: 0.4 + rng() * 0.6 });
      }
    }
  }

  // Arbolado: puntos al azar que no pisen calles, edificios ni otros árboles.
  const box = boundsOf(graph.points);
  const pad = 260;
  const width = box.maxX - box.minX + pad * 2;
  const height = box.maxY - box.minY + pad * 2;
  const attempts = Math.min(900, Math.floor((width * height) / 7000));
  const trees = [];
  for (let i = 0; i < attempts; i++) {
    const p = { x: box.minX - pad + rng() * width, y: box.minY - pad + rng() * height };
    const r = 11 + rng() * 13;
    if (!clearOfRoads(p, r + 8)) continue;
    if (buildings.some((o) => distance(o.c, p) < o.radius + r)) continue;
    if (trees.some((o) => distance(o, p) < (o.r + r) * 0.95)) continue;
    trees.push({ x: p.x, y: p.y, r, tone: rng() < 0.5 ? 0 : 1 });
  }
  return { buildings, trees };
}

function drawBuildings(ctx, buildings, colors) {
  const roofs = [colors.roof1, colors.roof2, colors.roof3];
  const fillPoly = (points, dx = 0, dy = 0) => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)));
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = colors.worldShadow;
  for (const b of buildings) fillPoly(b.corners, 8 + b.height * 10, 8 + b.height * 10);
  for (const b of buildings) {
    ctx.fillStyle = colors.building;
    fillPoly(b.corners);
    // Tejado a dos aguas: un poco más pequeño que la planta, con la cumbrera centrada.
    const inset = b.corners.map((p) => lerpPoint(p, b.c, 0.12));
    ctx.fillStyle = roofs[b.roof];
    fillPoly(inset);
    const half = (b.w / 2) * 0.72;
    ctx.strokeStyle = colors.roofLine;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.c.x - b.u.x * half, b.c.y - b.u.y * half);
    ctx.lineTo(b.c.x + b.u.x * half, b.c.y + b.u.y * half);
    ctx.stroke();
  }
}

function drawTrees(ctx, trees, colors) {
  ctx.fillStyle = colors.worldShadow;
  for (const t of trees) {
    ctx.beginPath();
    ctx.arc(t.x + t.r * 0.35, t.y + t.r * 0.4, t.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const t of trees) {
    ctx.fillStyle = t.tone ? colors.treeAlt : colors.tree;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = colors.treeLight;
  for (const t of trees) {
    ctx.beginPath();
    ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}
