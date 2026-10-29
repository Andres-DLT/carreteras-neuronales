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

// Vista 3D: perspectiva desde una cámara cenital situada sobre `eye` (el centro de
// la pantalla). Cuanto más lejos del centro y más alto es algo, más se inclina hacia
// fuera, como en una foto aérea. Se dibuja de lo más lejano a lo más cercano.
const EYE_HEIGHT = 900;
const project = (p, h, eye) => {
  const k = h / (EYE_HEIGHT - h);
  return { x: p.x + (p.x - eye.x) * k, y: p.y + (p.y - eye.y) * k };
};

function drawScenery3D(ctx, scenery, colors, eye) {
  const roofs = [colors.roof1, colors.roof2, colors.roof3];
  const fill = (points) => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  };

  // Sombras en el suelo primero, para que nada quede debajo de ellas.
  ctx.fillStyle = colors.worldShadow;
  for (const b of scenery.buildings) {
    const h = 6 + b.height * 10;
    fill(b.corners.map((p) => ({ x: p.x + h, y: p.y + h })));
  }
  for (const t of scenery.trees) {
    ctx.beginPath();
    ctx.arc(t.x + t.r * 0.35, t.y + t.r * 0.4, t.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const items = [
    ...scenery.buildings.map((b) => ({ b, d: distance(b.c, eye) })),
    ...scenery.trees.map((t) => ({ t, d: distance(t, eye) })),
  ].sort((p, q) => q.d - p.d);

  for (const item of items) {
    if (item.b) {
      const b = item.b;
      const H = 30 + b.height * 70; // de 3 a 9 pisos, más o menos
      const top = b.corners.map((p) => project(p, H, eye));
      // Paredes: primero las que dan la espalda a la cámara.
      const walls = b.corners
        .map((p, i) => {
          const q = b.corners[(i + 1) % 4];
          const mid = lerpPoint(p, q, 0.5);
          return { i, p, q, d: distance(mid, eye), mid };
        })
        .sort((m, n) => n.d - m.d);
      for (const w of walls) {
        ctx.fillStyle = colors.building;
        fill([w.p, w.q, top[(w.i + 1) % 4], top[w.i]]);
        // Sombreado según hacia dónde mira la pared (luz desde arriba a la izquierda).
        const nx = w.mid.x - b.c.x;
        const ny = w.mid.y - b.c.y;
        const len = Math.hypot(nx, ny) || 1;
        const light = (-0.6 * nx - 0.8 * ny) / len;
        ctx.globalAlpha = 0.55 * (1 - light) * 0.5;
        ctx.fillStyle = colors.wallShade;
        fill([w.p, w.q, top[(w.i + 1) % 4], top[w.i]]);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = roofs[b.roof];
      fill(top);
      const half = (b.w / 2) * 0.72;
      const ridgeA = project({ x: b.c.x - b.u.x * half, y: b.c.y - b.u.y * half }, H * 1.06, eye);
      const ridgeB = project({ x: b.c.x + b.u.x * half, y: b.c.y + b.u.y * half }, H * 1.06, eye);
      ctx.strokeStyle = colors.roofLine;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ridgeA.x, ridgeA.y);
      ctx.lineTo(ridgeB.x, ridgeB.y);
      ctx.stroke();
    } else {
      const t = item.t;
      const crown = project(t, 22 + t.r, eye);
      ctx.strokeStyle = colors.trunk;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(crown.x, crown.y);
      ctx.stroke();
      ctx.fillStyle = t.tone ? colors.treeAlt : colors.tree;
      ctx.beginPath();
      ctx.arc(crown.x, crown.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.treeLight;
      ctx.beginPath();
      ctx.arc(crown.x - t.r * 0.3, crown.y - t.r * 0.3, t.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
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
