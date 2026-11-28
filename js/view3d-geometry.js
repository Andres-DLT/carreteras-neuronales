"use strict";
// Geometría de la vista 3D: medidas de la escena (V3), altura de los puentes y las
// ayudas para construir mallas a mano (MeshBuilder) y unir geometrías (mergeGeometries).
// Lo usan view3d.js, view3d-cars.js, view3d-fx.js y view3d-city.js.
//
// three.js se carga solo cuando se pide la vista 3D (vendor/three.min.js), así que
// nada de este archivo puede usar THREE hasta que se crea un View3D.

const V3 = {
  SIDEWALK: 15, // ancho de la acera
  Y_SIDEWALK: 0.35,
  Y_ROAD: 0.7,
  Y_MARK: 1.05,
  Y_TRAIL: 1.4,
  FLOOR: 30, // alto de un piso (≈ 2.8 m)
  BAY: 30, // ancho de fachada que ocupa una ventana
  BRIDGE_HEIGHT: 36,
  BRIDGE_RAMP: 150,
  LAMP_GAP: 190, // separación entre farolas
  MAX_GHOSTS: 300,
  GHOST_NEAR: 48, // a menos de esto del líder, el resto de la población no se dibuja
  GHOST_FAR: 110, // y de ahí a aquí va creciendo hasta su tamaño
  MAX_DETAILED: 40,
  MAX_WALKERS: 400,
  TRAFFIC_STYLES: ["hatch", "suv", "sedan", "van", "hatch", "sedan"], // carrocerías del tráfico, por turno
  SHOTS: ["chase", "side", "drone", "front", "chase", "high"], // planos por los que pasa la cámara de director
  SHOT_FRAMES: 420, // lo que dura cada uno (7 s)
  WALLS: ["#f2efe6", "#ece2cf", "#e9d9c3", "#f4e6c8", "#dfe5e8", "#e8cdbb", "#d9d2c5", "#f0f0ee"],
  ROOFS: ["#b5573a", "#5f6b75", "#8a6a4a"],
  // Horas del día: cielo, niebla, luz del sol (o de la luna) y cuánto se encienden las
  // ventanas (windows) y las farolas y los faros (lamps).
  HOURS: {
    day: {
      zenith: "#3f8fe0", horizon: "#cfe4f5", fog: "#cfe4f5", hemiSky: "#cfe2ff", hemiGround: "#6b7a4c", hemi: 1.5,
      sun: "#fff0dc", sunPower: 3.1, sunDir: [-0.6, 1.15, -0.8], exposure: 0.95, windows: 0, lamps: 0, stars: false,
      orb: "#fff6da", orbSize: 1700,
    },
    sunset: {
      zenith: "#31508f", horizon: "#ffab6b", fog: "#eeb08a", hemiSky: "#f2c4a4", hemiGround: "#6a5644", hemi: 1.35,
      sun: "#ff9248", sunPower: 3, sunDir: [-0.92, 0.24, -0.45], exposure: 1.12, windows: 0.9, lamps: 0.55, stars: false,
      orb: "#ffb066", orbSize: 2600,
    },
    night: {
      zenith: "#03060f", horizon: "#1a2740", fog: "#141e30", hemiSky: "#5f6f99", hemiGround: "#14181a", hemi: 0.9,
      sun: "#bccaff", sunPower: 0.7, sunDir: [-0.6, 1.15, -0.8], exposure: 1.25, windows: 1.5, lamps: 1, stars: true,
      orb: "#e8eeff", orbSize: 1000,
    },
  },
};

// Altura del tablero de un puente a `t` unidades de su primer extremo.
function bridgeHeight(t, len) {
  const smooth = (x) => x * x * (3 - 2 * x);
  const up = smooth(clamp((t - 15) / V3.BRIDGE_RAMP, 0, 1));
  const down = smooth(clamp((len - t - 15) / V3.BRIDGE_RAMP, 0, 1));
  return V3.BRIDGE_HEIGHT * Math.min(up, down);
}

// ---------- Mallas a mano ----------
// Acumula vértices y triángulos y los entrega como una sola geometría: todo lo que
// comparte material (todas las fachadas, todas las marcas viales…) va en un solo dibujo.
class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  get empty() {
    return this.idx.length === 0;
  }

  vertex(p, n, uv, c) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  // Polígono plano y convexo (triángulo, cuadrilátero…). `normal` dice hacia dónde
  // mira: el orden de los vértices se corrige solo para que esa sea la cara visible.
  face(points, normal, uvs, color) {
    const [a, b, c] = points;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const facing = (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2];
    const base = points.map((p, i) => this.vertex(p, normal, uvs ? uvs[i] : [0, 0], color));
    for (let i = 1; i < base.length - 1; i++) {
      if (facing >= 0) this.idx.push(base[0], base[i], base[i + 1]);
      else this.idx.push(base[0], base[i + 1], base[i]);
    }
  }

  // Polígono convexo tumbado en el suelo a la altura y, con la textura repetida
  // cada `tile` unidades del mapa.
  flat(points, y, color, tile = 100) {
    this.face(
      points.map((p) => [p.x, y, p.y]),
      [0, 1, 0],
      points.map((p) => [p.x / tile, p.y / tile]),
      color
    );
  }

  // Tira recta sobre el suelo de a hacia b, de t0 a t1, desplazada `offset` hacia la
  // derecha y de ancho `width`; con dash/gap sale discontinua. `height` da la altura
  // en cada punto (para las marcas que suben a un puente).
  stripe(a, b, t0, t1, offset, width, color, dash = Infinity, gap = 0, height = null) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    const at = (t, side) => {
      const x = a.x + u.x * t + n.x * (offset + side * width * 0.5);
      const z = a.y + u.y * t + n.y * (offset + side * width * 0.5);
      return [x, height ? height(t) : V3.Y_MARK, z];
    };
    const step = Number.isFinite(dash) ? dash + gap : Infinity;
    for (let t = t0; t < t1 - 0.01; t += step) {
      const e = Math.min(t + dash, t1);
      this.face([at(t, -1), at(e, -1), at(e, 1), at(t, 1)], [0, 1, 0], null, color);
      if (!Number.isFinite(step)) break;
    }
  }

  // Caja apoyada en el suelo, orientada según el vector unitario u (y su perpendicular).
  box(c, u, halfU, halfN, y0, y1, color, top = true) {
    const n = { x: -u.y, y: u.x };
    const corner = (i, j, y) => [c.x + u.x * halfU * i + n.x * halfN * j, y, c.y + u.y * halfU * i + n.y * halfN * j];
    const sides = [
      [[-1, -1], [1, -1], [-n.x, 0, -n.y]],
      [[1, -1], [1, 1], [u.x, 0, u.y]],
      [[1, 1], [-1, 1], [n.x, 0, n.y]],
      [[-1, 1], [-1, -1], [-u.x, 0, -u.y]],
    ];
    for (const [p, q, normal] of sides) {
      this.face([corner(p[0], p[1], y0), corner(q[0], q[1], y0), corner(q[0], q[1], y1), corner(p[0], p[1], y1)], normal, null, color);
    }
    if (top) this.face([corner(-1, -1, y1), corner(1, -1, y1), corner(1, 1, y1), corner(-1, 1, y1)], [0, 1, 0], null, color);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// Une varias geometrías de three.js en una sola, cada una pintada de un color.
function mergeGeometries(parts) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const t = g.getAttribute("uv");
    const c = new THREE.Color(color || "#ffffff");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return out;
}
