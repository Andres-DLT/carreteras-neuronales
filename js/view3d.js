"use strict";
// Vista 3D realista con three.js: el mismo mundo de la simulación, pero con cámara en
// perspectiva, luz del sol (o de la luna, con el tema oscuro), sombras, casas con
// tejado y ventanas, árboles, coches con volumen, farolas y semáforos con poste.
//
// Aquí solo se dibuja: la simulación sigue siendo la de siempre, en dos dimensiones.
// Las coordenadas del mapa (x, y) pasan a ser (x, altura, y) en la escena, y un ángulo
// del mapa equivale a girar -ángulo alrededor del eje vertical.
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
  MAX_DETAILED: 40,
  MAX_WALKERS: 400,
  WALLS: ["#f2efe6", "#ece2cf", "#e9d9c3", "#f4e6c8", "#dfe5e8", "#e8cdbb", "#d9d2c5", "#f0f0ee"],
  ROOFS: ["#b5573a", "#5f6b75", "#8a6a4a"],
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

class View3D {
  static supported() {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  }

  // small: pantalla pequeña (móvil): sombras y texturas más ligeras.
  constructor(canvas, { small = false } = {}) {
    this.canvas = canvas;
    this.small = small;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 8, 20000);
    this.camPos = new THREE.Vector3(0, 400, 400);
    this.camTarget = new THREE.Vector3();
    this.camHeading = 0;
    this.camReady = false;

    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.frame = 0;
    this.night = null;
    this.colors = null;
    this.worldKey = null;
    this.worldGroup = null;
    this.cache = new Map(); // escenas ya construidas (la gira todoterreno alterna entre mapas)

    this.makeTextures();
    this.makeMaterials();
    this.makeSky();
    this.makeLights();
    this.makeGround();
    this.makeActors();
  }

  // ---------- Texturas dibujadas en un lienzo ----------
  texture(size, paint, repeat = true) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    paint(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.anisotropy;
    return t;
  }

  makeTextures() {
    const rng = seededRandom(7);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const speckle = (ctx, size, count, tones, alpha, max = 2) => {
      for (let i = 0; i < count; i++) {
        ctx.globalAlpha = alpha * (0.4 + rng() * 0.6);
        ctx.fillStyle = pick(tones);
        const s = 1 + Math.floor(rng() * max);
        ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), s, s);
      }
      ctx.globalAlpha = 1;
    };

    this.tex = {};
    this.tex.grass = this.texture(256, (ctx, s) => {
      ctx.fillStyle = "#6b9649";
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 14000, ["#5b8a3e", "#7aa853", "#4f7d38", "#88b25e", "#648f43"], 0.55, 3);
    });
    this.tex.asphalt = this.texture(256, (ctx, s) => {
      ctx.fillStyle = "#4b4e50";
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 22000, ["#444749", "#55595b", "#5e6264", "#3f4244", "#505456"], 0.4, 1);
    });
    this.tex.sidewalk = this.texture(256, (ctx, s) => {
      ctx.fillStyle = "#bcb9b0";
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 6000, ["#a9a69d", "#cbc8bf", "#b1aea5"], 0.5, 2);
      ctx.strokeStyle = "rgba(60, 58, 52, 0.38)";
      ctx.lineWidth = 2;
      for (let i = 0; i <= s; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, s);
        ctx.moveTo(0, i);
        ctx.lineTo(s, i);
        ctx.stroke();
      }
    });
    // Tejas: hiladas horizontales con las juntas alternadas. Clara, para teñirla.
    this.tex.roof = this.texture(128, (ctx, s) => {
      ctx.fillStyle = "#e9e2da";
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 2500, ["#d6cec5", "#f6f0ea", "#c9c1b8"], 0.5, 2);
      for (let row = 0; row < 8; row++) {
        const y = row * 16;
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
        ctx.fillRect(0, y + 13, s, 3);
        ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
        ctx.fillRect(0, y, s, 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
        for (let x = (row % 2) * 8; x < s; x += 16) ctx.fillRect(x, y, 1.5, 13);
      }
    });
    this.tex.leaves = this.texture(128, (ctx, s) => {
      ctx.fillStyle = "#e6eee0";
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 5000, ["#aebf9f", "#ffffff", "#93a884", "#cfdcc4"], 0.6, 4);
    });

    // Fachadas: un atlas de 4 × 4 huecos, cada uno con su ventana. Va en dos versiones
    // con el mismo reparto: la de día y la que solo tiene las ventanas encendidas.
    const lit = Array.from({ length: 16 }, () => rng() < 0.42);
    const blinds = Array.from({ length: 16 }, () => rng());
    const cell = 128;
    const windowBox = { x: 36, y: 26, w: 56, h: 70 };
    this.tex.facade = this.texture(cell * 4, (ctx, s) => {
      ctx.fillStyle = "#f3f0e9";
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 9000, ["#e6e2d9", "#fbf9f4", "#dcd8ce"], 0.5, 3);
      for (let i = 0; i < 16; i++) {
        const ox = (i % 4) * cell + windowBox.x;
        const oy = Math.floor(i / 4) * cell + windowBox.y;
        const { w, h } = windowBox;
        ctx.fillStyle = "rgba(0, 0, 0, 0.22)"; // sombra del hueco
        ctx.fillRect(ox - 5, oy - 3, w + 10, h + 12);
        ctx.fillStyle = "#fbfbf8"; // marco
        ctx.fillRect(ox - 4, oy - 4, w + 8, h + 8);
        const glass = ctx.createLinearGradient(ox, oy, ox + w, oy + h);
        glass.addColorStop(0, "#5d7b96");
        glass.addColorStop(0.5, "#2c3f52");
        glass.addColorStop(1, "#1d2a38");
        ctx.fillStyle = glass;
        ctx.fillRect(ox, oy, w, h);
        ctx.fillStyle = "rgba(255, 255, 255, 0.16)"; // reflejo
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + w * 0.55, oy);
        ctx.lineTo(ox, oy + h * 0.6);
        ctx.fill();
        if (blinds[i] < 0.35) {
          ctx.fillStyle = "#e9e3d6"; // persiana a medio bajar
          ctx.fillRect(ox, oy, w, h * (0.25 + blinds[i]));
        }
        ctx.fillStyle = "#fbfbf8"; // travesaños
        ctx.fillRect(ox + w / 2 - 1.5, oy, 3, h);
        ctx.fillRect(ox, oy + h * 0.45, w, 3);
        ctx.fillStyle = "#d8d3c8"; // alféizar
        ctx.fillRect(ox - 8, oy + h + 4, w + 16, 6);
      }
    });
    this.tex.facadeLit = this.texture(cell * 4, (ctx, s) => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 16; i++) {
        if (!lit[i]) continue;
        const ox = (i % 4) * cell + windowBox.x;
        const oy = Math.floor(i / 4) * cell + windowBox.y;
        const { w, h } = windowBox;
        const glow = ctx.createLinearGradient(ox, oy, ox, oy + h);
        glow.addColorStop(0, "#ffe2a0");
        glow.addColorStop(1, "#ffb14f");
        ctx.fillStyle = glow;
        ctx.fillRect(ox, oy, w, h);
        ctx.fillStyle = "#3a2a14";
        ctx.fillRect(ox + w / 2 - 1.5, oy, 3, h);
        ctx.fillRect(ox, oy + h * 0.45, w, 3);
      }
    });

    this.tex.dot = this.texture(32, (ctx, s) => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
      ctx.fill();
    }, false);
    // Charco de luz de una farola y cono de los faros de un coche.
    this.tex.pool = this.texture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255, 255, 255, 1)");
      g.addColorStop(0.35, "rgba(255, 255, 255, 0.45)");
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }, false);
    this.tex.beam = this.texture(128, (ctx, s) => {
      for (let i = 0; i < 6; i++) {
        const spread = s * (0.46 - i * 0.055);
        const g = ctx.createLinearGradient(0, 0, s, 0);
        g.addColorStop(0, "rgba(255, 255, 255, 0.34)");
        g.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, s / 2 - 5);
        ctx.lineTo(s, s / 2 - spread);
        ctx.lineTo(s, s / 2 + spread);
        ctx.lineTo(0, s / 2 + 5);
        ctx.fill();
      }
    }, false);
  }

  makeMaterials() {
    const std = (options) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...options });
    const decal = (factor) => ({ polygonOffset: true, polygonOffsetFactor: -factor, polygonOffsetUnits: -factor });
    this.mat = {
      grass: std({ map: this.tex.grass, roughness: 1 }),
      sidewalk: std({ map: this.tex.sidewalk, vertexColors: true, ...decal(1) }),
      asphalt: std({ map: this.tex.asphalt, vertexColors: true, roughness: 0.88, ...decal(2) }),
      marks: std({ vertexColors: true, roughness: 0.75, ...decal(3) }),
      walls: std({ map: this.tex.facade, emissiveMap: this.tex.facadeLit, emissive: 0xffd9a0, emissiveIntensity: 0, vertexColors: true }),
      roofs: std({ map: this.tex.roof, vertexColors: true, roughness: 0.82 }),
      parts: std({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
      trunk: std({ color: 0x5b4330 }),
      crown: std({ map: this.tex.leaves, roughness: 0.95 }),
      pole: std({ color: 0x3c4244, roughness: 0.55, metalness: 0.5 }),
      bulb: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      lamp: new THREE.MeshBasicMaterial({ toneMapped: false }),
      pool: new THREE.MeshBasicMaterial({
        map: this.tex.pool, color: 0xffc98a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, ...decal(4),
      }),
      beam: new THREE.MeshBasicMaterial({
        map: this.tex.beam, color: 0xfff1cf, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, ...decal(5),
      }),
      paint: std({ roughness: 0.36, metalness: 0.25 }),
      trim: std({ vertexColors: true, roughness: 0.3, metalness: 0.3 }),
      carLights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      ghost: std({ roughness: 0.5, transparent: true, opacity: 0.14, depthWrite: false }),
      shirt: std({ roughness: 0.9 }),
      skin: std({ color: 0xd9b08c, roughness: 0.8 }),
      trail: new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, ...decal(6),
      }),
      path: new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, ...decal(7),
      }),
      rays: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85, toneMapped: false }),
      hits: new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, toneMapped: false, map: this.tex.dot, alphaTest: 0.5 }),
    };
  }

  // ---------- Cielo, luces y suelo ----------
  makeSky() {
    const geo = new THREE.SphereGeometry(15000, 32, 16);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 3), 3));
    this.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Estrellas: puntos repartidos por la mitad alta de la bóveda.
    const rng = seededRandom(99);
    const stars = [];
    for (let i = 0; i < 900; i++) {
      const a = rng() * Math.PI * 2;
      const h = 0.06 + rng() * 0.94;
      const r = Math.sqrt(1 - h * h);
      stars.push(Math.cos(a) * r * 14000, h * 14000, Math.sin(a) * r * 14000);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(stars, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false, toneMapped: false, transparent: true, opacity: 0.85 }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.sky.add(this.stars);
  }

  paintSky(zenith, horizon) {
    const top = new THREE.Color(zenith);
    const low = new THREE.Color(horizon);
    const pos = this.sky.geometry.getAttribute("position");
    const col = this.sky.geometry.getAttribute("color");
    for (let i = 0; i < pos.count; i++) {
      const h = clamp(pos.getY(i) / 15000, 0, 1);
      this.tmpColor.copy(low).lerp(top, Math.pow(h, 0.55));
      col.setXYZ(i, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    }
    col.needsUpdate = true;
  }

  makeLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.scene.add(this.hemi);
    // El sol (o la luna): de arriba a la izquierda del mapa, como el sombreado en plano.
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const size = this.small ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 1.2;
    this.sunOffset = new THREE.Vector3(-0.6, 1.15, -0.8).normalize();
    this.scene.add(this.sun, this.sun.target);
    this.shadowSize = 0;
    // Faros del líder: una luz de verdad, que alumbra la calle, las casas y los árboles.
    this.headlamp = new THREE.SpotLight(0xfff0d0, 0, 520, 0.5, 0.7, 0);
    this.headlamp.visible = false;
    this.scene.add(this.headlamp, this.headlamp.target);
    // Resplandor de las farolas alrededor de donde mira la cámara: sin él, de noche los
    // colores de los coches se apagan bajo la luz azulada de la luna.
    this.glow = new THREE.PointLight(0xffd6a0, 0, 900, 0);
    this.scene.add(this.glow);
    this.scene.fog = new THREE.Fog(0xffffff, 2000, 12000);
  }

  makeGround() {
    const geo = new THREE.PlaneGeometry(80000, 80000);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 360, uv.getY(i) * 360);
    this.ground = new THREE.Mesh(geo, this.mat.grass);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  // Día con el tema claro, noche con el oscuro. Los colores de los coches son los del tema.
  setTheme(colors) {
    this.colors = colors;
    const night = !!colors.night;
    if (night !== this.night) {
      this.night = night;
      this.paintSky(night ? "#03060f" : "#3f8fe0", night ? "#1a2740" : "#cfe4f5");
      this.scene.fog.color.set(night ? "#141e30" : "#cfe4f5");
      this.stars.visible = night;
      this.hemi.color.set(night ? "#5f6f99" : "#cfe2ff");
      this.hemi.groundColor.set(night ? "#14181a" : "#6b7a4c");
      this.hemi.intensity = night ? 0.9 : 1.5;
      this.sun.color.set(night ? "#bccaff" : "#fff0dc");
      this.sun.intensity = night ? 0.7 : 3.1;

      this.renderer.toneMappingExposure = night ? 1.25 : 0.95;
      this.mat.walls.emissiveIntensity = night ? 1.5 : 0;
      this.mat.bulb.color.set(night ? "#ffe6b0" : "#d9dcdc");
      this.headlamp.visible = night;
      this.headlamp.intensity = night ? 9 : 0;
      this.mat.carLights.color.setScalar(night ? 1 : 0.8);
    }
    this.mat.rays.color.set(colors.leader);
    this.mat.hits.color.set(colors.leader);
    this.mat.path.color.set(colors.leader);
    this.signalColors = ["red", "yellow", "green"].map((k) => new THREE.Color(colors.signal[k]));
  }

  // ---------- Lo que se mueve: coches, peatones, sensores, estelas ----------
  makeActors() {
    const dyn = (mesh, shadows) => {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    const car = this.carGeometries();
    this.carPaint = dyn(new THREE.InstancedMesh(car.paint, this.mat.paint, V3.MAX_DETAILED), true);
    this.carTrim = dyn(new THREE.InstancedMesh(car.trim, this.mat.trim, V3.MAX_DETAILED), true);
    this.carLamps = dyn(new THREE.InstancedMesh(car.lights, this.mat.carLights, V3.MAX_DETAILED), false);
    this.ghosts = dyn(new THREE.InstancedMesh(car.paint, this.mat.ghost, V3.MAX_GHOSTS), false);
    this.ghosts.renderOrder = 5;

    const beam = new THREE.PlaneGeometry(1, 1);
    beam.rotateX(-Math.PI / 2);
    this.beams = dyn(new THREE.InstancedMesh(beam, this.mat.beam, V3.MAX_DETAILED), false);
    this.beams.renderOrder = 4;

    const body = new THREE.CapsuleGeometry(2.7, 8, 4, 10);
    body.translate(0, 8.2, 0);
    const head = new THREE.SphereGeometry(2.5, 12, 10);
    head.translate(0, 17.2, 0);
    this.walkerBodies = dyn(new THREE.InstancedMesh(body, this.mat.shirt, V3.MAX_WALKERS), true);
    this.walkerHeads = dyn(new THREE.InstancedMesh(head, this.mat.skin, V3.MAX_WALKERS), true);

    // Rayos de los sensores del líder y los puntos donde tocan algo.
    const rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(7 * 2 * 3), 3));
    this.rays = new THREE.LineSegments(rayGeo, this.mat.rays);
    this.rays.frustumCulled = false;
    const hitGeo = new THREE.BufferGeometry();
    hitGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(7 * 3), 3));
    this.hits = new THREE.Points(hitGeo, this.mat.hits);
    this.hits.frustumCulled = false;
    this.scene.add(this.rays, this.hits);

    // Estelas de luz: el lienzo de las estelas, tendido sobre el asfalto.
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    // La textura va sin voltear (así se pueden subir trozos sueltos): se voltea el plano.
    const planeUv = plane.getAttribute("uv");
    for (let i = 0; i < planeUv.count; i++) planeUv.setY(i, 1 - planeUv.getY(i));
    this.tileCanvas = document.createElement("canvas");
    this.tileTexture = new THREE.CanvasTexture(this.tileCanvas);
    this.tileAt = new THREE.Vector2();
    this.trailPlane = new THREE.Mesh(plane, this.mat.trail);
    this.trailPlane.visible = false;
    this.trailPlane.renderOrder = 2;
    this.trailCanvas = null;
    // Recorrido del líder: una cinta que se rehace en cada fotograma.
    this.pathMax = 1400;
    const pathGeo = new THREE.BufferGeometry();
    pathGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(this.pathMax * 2 * 3), 3));
    const pathIdx = [];
    for (let i = 0; i < this.pathMax - 1; i++) pathIdx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    pathGeo.setIndex(pathIdx);
    this.pathMesh = new THREE.Mesh(pathGeo, this.mat.path);
    this.pathMesh.frustumCulled = false;
    this.pathMesh.renderOrder = 3;
    this.pathMesh.visible = false;
    this.scene.add(this.trailPlane, this.pathMesh);
  }

  // Un coche de tres volúmenes: carrocería con capó y maletero, cabina acristalada con
  // techo, cuatro ruedas, faros y pilotos. Mira hacia +x, como en la simulación.
  carGeometries() {
    const profile = (points) => {
      const shape = new THREE.Shape();
      points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
      shape.closePath();
      return shape;
    };
    const extrude = (points, width, bevel) => {
      const geo = new THREE.ExtrudeGeometry(profile(points), {
        depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, steps: 1,
      });
      geo.translate(0, 0, -(width - bevel * 2) / 2);
      return geo;
    };
    const body = extrude(
      [[-23, 4.4], [-22.6, 8.2], [-20.6, 9.7], [-12, 9.9], [9, 9.7], [18.5, 8.8], [22.6, 7.3], [23, 4.6], [22, 3.2], [-22, 3.2]],
      CAR_WIDTH, 1.3
    );
    const roof = new THREE.BoxGeometry(12.6, 0.9, CAR_WIDTH - 6.6);
    roof.translate(-3.7, 15.2, 0);
    const cabin = extrude([[-15.6, 9.6], [-10.6, 14.9], [2.9, 15.1], [10, 9.6]], CAR_WIDTH - 5, 0.7);
    const parts = [{ geo: cabin, color: "#18222c" }];
    for (const x of [-15.2, 15.2]) {
      for (const z of [-1, 1]) {
        const tyre = new THREE.CylinderGeometry(4.5, 4.5, 3.6, 18);
        tyre.rotateX(Math.PI / 2);
        tyre.translate(x, 4.5, z * (CAR_WIDTH / 2 - 1.5));
        const hub = new THREE.CylinderGeometry(2.4, 2.4, 3.9, 12);
        hub.rotateX(Math.PI / 2);
        hub.translate(x, 4.5, z * (CAR_WIDTH / 2 - 1.5));
        parts.push({ geo: tyre, color: "#141414" }, { geo: hub, color: "#9da2a6" });
      }
    }
    const lights = [];
    for (const z of [-8, 8]) {
      const front = new THREE.BoxGeometry(0.8, 2.2, 5.6);
      front.translate(CAR_LENGTH / 2 + 0.25, 7.3, z);
      const rear = new THREE.BoxGeometry(0.8, 2, 5.6);
      rear.translate(-CAR_LENGTH / 2 - 0.25, 7.9, z);
      lights.push({ geo: front, color: "#fff6d8" }, { geo: rear, color: "#ff2a1c" });
    }
    return {
      paint: mergeGeometries([{ geo: body }, { geo: roof }]),
      trim: mergeGeometries(parts),
      lights: mergeGeometries(lights),
    };
  }

  // ---------- Escena de un mapa ----------
  // Devuelve (y guarda) todo lo que no se mueve de un mapa. `key` cambia cuando cambia
  // el mapa o lo que se pinta sobre él (pasos de cebra, líneas de detención, salida).
  setWorld(world, options) {
    const { x, y, angle } = world.start;
    const key = [world.version, options.pedestrians, options.lights, Math.round(x), Math.round(y), angle.toFixed(3)].join("|");
    let entry = this.cache.get(world);
    if (!entry || entry.key !== key) {
      if (entry) this.disposeGroup(entry.group);
      entry = { key, ...this.buildWorld(world, options) };
      this.cache.delete(world);
      this.cache.set(world, entry);
      // Como mucho, las escenas de los cuatro mapas de la gira.
      while (this.cache.size > 4) {
        const [oldest, old] = this.cache.entries().next().value;
        if (old.group === this.worldGroup) break;
        this.disposeGroup(old.group);
        this.cache.delete(oldest);
      }
    }
    if (this.worldGroup !== entry.group) {
      if (this.worldGroup) this.scene.remove(this.worldGroup);
      this.scene.add(entry.group);
      this.worldGroup = entry.group;
      this.signals = entry.signals;
      this.pools = entry.pools;
      this.camReady = false;
    }
    this.world = world;
    this.pools.visible = this.night;
    this.signals.group.visible = options.lights;
  }

  disposeGroup(group) {
    group.traverse((o) => {
      if (o.geometry && !o.userData.shared) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
    if (group === this.worldGroup) {
      this.scene.remove(group);
      this.worldGroup = null;
    }
  }

  buildWorld(world, options) {
    const group = new THREE.Group();
    const add = (builder, material, { cast = false, receive = true } = {}) => {
      if (builder.empty) return null;
      const mesh = new THREE.Mesh(builder.geometry(), material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      group.add(mesh);
      return mesh;
    };
    const white = new THREE.Color("#ffffff");

    // Aceras y asfalto: cada tramo es un polígono convexo; se solapan en los cruces.
    const walks = new MeshBuilder();
    for (const s of world.graph.segments) {
      if (s.type !== "puente") walks.flat(this.orient(roadEnvelope(s.a, s.b, roadType(s).width + V3.SIDEWALK * 2)), V3.Y_SIDEWALK, white, 60);
    }
    add(walks, this.mat.sidewalk);
    const asphalt = new MeshBuilder();
    for (const envelope of world.groundEnvelopes) asphalt.flat(this.orient(envelope), V3.Y_ROAD, white, 120);
    add(asphalt, this.mat.asphalt);

    add(this.buildMarkings(world, options), this.mat.marks);
    this.buildBridges(world, group);
    this.buildHouses(world, group);
    this.buildTrees(world, group);
    const pools = this.buildLamps(world, group);
    const signals = this.buildSignals(world, group);
    return { group, pools, signals };
  }

  // Los polígonos del suelo tienen que ir en el sentido que deja la cara hacia arriba.
  orient(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      area += p.x * q.y - q.x * p.y;
    }
    return area > 0 ? [...points].reverse() : points;
  }

  // Las mismas marcas que en plano: eje, carriles, flechas, bordillo, pasos de cebra,
  // líneas de detención y la salida a cuadros.
  buildMarkings(world, options) {
    const m = new MeshBuilder();
    const yellow = new THREE.Color("#e2ad1f");
    const paint = new THREE.Color("#ecece6");
    const curb = new THREE.Color("#c9c7bf");
    const dark = new THREE.Color("#1c1f1d");
    for (const s of world.graph.segments) {
      if (s.type === "puente") continue;
      const length = distance(s.a, s.b);
      const trimA = (world.degrees.get(s.a) || 0) > 2 ? world.nodeHalf.get(s.a) : 0;
      const trimB = (world.degrees.get(s.b) || 0) > 2 ? world.nodeHalf.get(s.b) : 0;
      if (length <= trimA + trimB + 12) continue;
      const from = trimA;
      const to = length - trimB;
      const type = s.type || "normal";
      if (type === "avenida") {
        m.stripe(s.a, s.b, from, to, -4, 3, yellow);
        m.stripe(s.a, s.b, from, to, 4, 3, yellow);
        m.stripe(s.a, s.b, from, to, -40, 3, paint, 18, 22);
        m.stripe(s.a, s.b, from, to, 40, 3, paint, 18, 22);
      } else if (type === "unico" || type === "glorieta") {
        m.stripe(s.a, s.b, from, to, 0, 3, paint, 18, 22);
        const u = unitVector(s.a, s.b);
        const n = { x: -u.y, y: u.x };
        const at = (c, i, j) => ({ x: c.x + u.x * i + n.x * j, y: c.y + u.y * i + n.y * j });
        for (let t = trimA + 50; t < length - trimB - 40; t += 150) {
          for (const lane of [-25, 25]) {
            const c = { x: s.a.x + u.x * t + n.x * lane, y: s.a.y + u.y * t + n.y * lane };
            m.flat(this.orient([at(c, 14, 0), at(c, 2, -8), at(c, 2, 8)]), V3.Y_MARK, paint);
            m.flat(this.orient([at(c, -14, -3), at(c, 2, -3), at(c, 2, 3), at(c, -14, 3)]), V3.Y_MARK, paint);
          }
        }
      } else {
        m.stripe(s.a, s.b, from, to, 0, 4, yellow, 24, 20);
      }
    }
    // Bordillo: una línea clara por todo el borde de la calzada.
    for (const [p, q] of world.borders) {
      const len = distance(p, q);
      if (len > 0.5) m.stripe(p, q, -1.5, len + 1.5, 0, 5, curb);
    }
    if (options.pedestrians) {
      for (const { c, u } of world.crosswalks) {
        const n = { x: -u.y, y: u.x };
        const a = { x: c.x - n.x * (ROAD_WIDTH / 2 - 6), y: c.y - n.y * (ROAD_WIDTH / 2 - 6) };
        const b = { x: c.x + n.x * (ROAD_WIDTH / 2 - 6), y: c.y + n.y * (ROAD_WIDTH / 2 - 6) };
        m.stripe(a, b, 0, ROAD_WIDTH - 12, 0, CROSSWALK_DEPTH, paint, 6, 6);
      }
    }
    if (options.lights) {
      for (const x of world.intersections) {
        for (const a of x.approaches) {
          const from = roadType(a.segment).oneway ? -(a.half - 5) : 0;
          const p = { x: a.stop.x + a.right.x * from, y: a.stop.y + a.right.y * from };
          const q = { x: a.stop.x + a.right.x * (a.half - 5), y: a.stop.y + a.right.y * (a.half - 5) };
          m.stripe(p, q, 0, distance(p, q), 0, 5, paint);
        }
      }
    }
    // Salida: dos filas de cuadros que atraviesan la calzada.
    const { x, y, angle } = world.start;
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const n = { x: -u.y, y: u.x };
    const size = 9;
    const half = ROAD_WIDTH / 2 - 4;
    for (let row = 0; row < 2; row++) {
      for (let i = 0, yy = -half; yy < half - 0.1; i++, yy += size) {
        const h = Math.min(size, half - yy);
        const x0 = -size + row * size;
        const corner = (i2, j2) => ({ x: x + u.x * i2 + n.x * j2, y: y + u.y * i2 + n.y * j2 });
        m.flat(this.orient([corner(x0, yy), corner(x0 + size, yy), corner(x0 + size, yy + h), corner(x0, yy + h)]), V3.Y_MARK + 0.05, (i + row) % 2 ? dark : paint);
      }
    }
    return m;
  }

  // Puentes: tablero que sube en rampa y cruza por encima, con barandillas y pilares.
  buildBridges(world, group) {
    if (!world.bridges.length) return;
    const deck = new MeshBuilder();
    const parts = new MeshBuilder();
    const marks = new MeshBuilder();
    const white = new THREE.Color("#ffffff");
    const concrete = new THREE.Color("#a9a9a3");
    const yellow = new THREE.Color("#e2ad1f");
    const paint = new THREE.Color("#ecece6");
    for (const b of world.bridges) {
      const { a } = b.segment;
      const u = b.u;
      const n = { x: -u.y, y: u.x };
      const half = ROAD_WIDTH / 2;
      const h = (t) => bridgeHeight(t, b.len) + 1.7;
      const edge = (t, side, lift = 0) => [a.x + u.x * t + n.x * half * side, h(t) + lift, a.y + u.y * t + n.y * half * side];
      const step = 14;
      for (let t = 0; t < b.len; t += step) {
        const e = Math.min(t + step, b.len);
        const slope = (h(e) - h(t)) / (e - t);
        const k = 1 / Math.hypot(1, slope);
        const normal = [-u.x * slope * k, k, -u.y * slope * k];
        deck.face(
          [edge(t, -1), edge(e, -1), edge(e, 1), edge(t, 1)], normal,
          [[t / 120, 0], [e / 120, 0], [e / 120, 0.83], [t / 120, 0.83]], white
        );
        for (const side of [-1, 1]) {
          const out = [n.x * side, 0, n.y * side];
          parts.face([edge(t, side, -4), edge(e, side, -4), edge(e, side, 0), edge(t, side, 0)], out, null, concrete); // canto
          parts.face([edge(t, side, 0), edge(e, side, 0), edge(e, side, 8), edge(t, side, 8)], out, null, concrete); // barandilla
        }
      }
      const lift = (t) => h(t) + 0.45;
      marks.stripe(b.segment.a, b.segment.b, 0, b.len, 0, 4, yellow, 24, 20, lift);
      marks.stripe(b.segment.a, b.segment.b, 0, b.len, -(half - 6), 3, paint, Infinity, 0, lift);
      marks.stripe(b.segment.a, b.segment.b, 0, b.len, half - 6, 3, paint, Infinity, 0, lift);
      // Pilares donde el tablero ya va alto, sin pisar las calles que pasan por debajo.
      for (let t = 60; t < b.len - 60; t += 110) {
        const top = h(t) - 4;
        if (top < 16) continue;
        const c = { x: a.x + u.x * t, y: a.y + u.y * t };
        const blocked = world.groundEnvelopes.some((env) => pointInPolygon(c, env));
        if (!blocked) parts.box(c, u, 7, half * 0.7, 0, top, concrete, false);
      }
    }
    const make = (builder, material, cast) => {
      if (builder.empty) return;
      const mesh = new THREE.Mesh(builder.geometry(), material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    make(deck, this.mat.asphalt, true);
    make(parts, this.mat.parts, true);
    make(marks, this.mat.marks, false);
  }

  // Casas: paredes con ventanas, tejado a cuatro aguas con alero (o azotea) y chimenea.
  buildHouses(world, group) {
    const walls = new MeshBuilder();
    const roofs = new MeshBuilder();
    const wallTones = V3.WALLS.map((c) => new THREE.Color(c));
    const roofTones = V3.ROOFS.map((c) => new THREE.Color(c));
    const flatTone = new THREE.Color("#8f918c");
    const brick = new THREE.Color("#8c4a3a");
    for (const b of world.scenery.buildings) {
      const hash = (Math.imul(Math.round(b.c.x), 73856093) ^ Math.imul(Math.round(b.c.y), 19349663)) >>> 0;
      const flat = hash % 5 === 0;
      const floors = flat ? 2 + (hash % 7 === 0 ? 1 : 0) : b.height > 0.72 ? 2 : 1;
      const H = floors * V3.FLOOR + 3;
      const u = b.u;
      const n = { x: -u.y, y: u.x };
      const tone = wallTones[(hash >>> 3) % wallTones.length];
      const normals = [[-n.x, 0, -n.y], [u.x, 0, u.y], [n.x, 0, n.y], [-u.x, 0, -u.y]];
      b.corners.forEach((p, i) => {
        const q = b.corners[(i + 1) % 4];
        const bays = Math.max(1, Math.round(distance(p, q) / V3.BAY));
        const u0 = ((hash >>> (i * 2)) % 4) / 4;
        const v0 = ((hash >>> (i * 2 + 8)) % 4) / 4;
        walls.face(
          [[p.x, 0, p.y], [q.x, 0, q.y], [q.x, H, q.y], [p.x, H, p.y]], normals[i],
          [[u0, v0], [u0 + bays / 4, v0], [u0 + bays / 4, v0 + floors / 4], [u0, v0 + floors / 4]], tone
        );
      });

      const at = (i, j, y) => [b.c.x + u.x * i + n.x * j, y, b.c.y + u.y * i + n.y * j];
      if (flat) {
        // Azotea con un pretil alrededor.
        const hw = b.w / 2, hd = b.d / 2;
        roofs.face([at(-hw, -hd, H), at(hw, -hd, H), at(hw, hd, H), at(-hw, hd, H)], [0, 1, 0], [[0, 0], [b.w / 40, 0], [b.w / 40, b.d / 40], [0, b.d / 40]], flatTone);
        for (const [cx, cy, lu, ln] of [[0, -hd + 1.5, hw, 1.5], [0, hd - 1.5, hw, 1.5], [-hw + 1.5, 0, 1.5, hd], [hw - 1.5, 0, 1.5, hd]]) {
          const c = { x: b.c.x + u.x * cx + n.x * cy, y: b.c.y + u.y * cx + n.y * cy };
          walls.box(c, u, lu, ln, H, H + 4, tone);
        }
        continue;
      }
      const over = 5; // alero
      const hw = b.w / 2 + over, hd = b.d / 2 + over;
      const alongU = b.w >= b.d;
      const rise = Math.min(b.w, b.d) * 0.3;
      const ridge = Math.abs(b.w - b.d) / 2 + 3;
      const eaves = [at(-hw, -hd, H), at(hw, -hd, H), at(hw, hd, H), at(-hw, hd, H)];
      const r0 = alongU ? at(-ridge, 0, H + rise) : at(0, -ridge, H + rise);
      const r1 = alongU ? at(ridge, 0, H + rise) : at(0, ridge, H + rise);
      const faces = alongU
        ? [[eaves[0], eaves[1], r1, r0], [eaves[1], eaves[2], r1], [eaves[2], eaves[3], r0, r1], [eaves[3], eaves[0], r0]]
        : [[eaves[0], eaves[1], r0], [eaves[1], eaves[2], r1, r0], [eaves[2], eaves[3], r1], [eaves[3], eaves[0], r0, r1]];
      const tint = roofTones[b.roof % roofTones.length];
      for (const pts of faces) this.roofFace(roofs, pts, tint);
      if (hash % 3 === 0) {
        const c = alongU ? { x: b.c.x + u.x * ridge * 0.5 + n.x * b.d * 0.2, y: b.c.y + u.y * ridge * 0.5 + n.y * b.d * 0.2 }
          : { x: b.c.x + n.x * ridge * 0.5 + u.x * b.w * 0.2, y: b.c.y + n.y * ridge * 0.5 + u.y * b.w * 0.2 };
        roofs.box(c, u, 4, 4, H + rise * 0.3, H + rise + 9, brick);
      }
    }
    for (const [builder, material] of [[walls, this.mat.walls], [roofs, this.mat.roofs]]) {
      if (builder.empty) continue;
      const mesh = new THREE.Mesh(builder.geometry(), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // Una vertiente del tejado: las tejas corren paralelas al alero (los dos primeros puntos).
  roofFace(builder, pts, color) {
    const [a, b] = pts;
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(e[0], e[1], e[2]) || 1;
    e[0] /= len; e[1] /= len; e[2] /= len;
    const c = pts[2];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let normal = [e[1] * v[2] - e[2] * v[1], e[2] * v[0] - e[0] * v[2], e[0] * v[1] - e[1] * v[0]];
    const nl = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    normal = normal.map((k) => (k / nl) * (normal[1] < 0 ? -1 : 1));
    const uvs = pts.map((p) => {
      const d = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const along = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
      const up = Math.hypot(d[0] - e[0] * along, d[1] - e[1] * along, d[2] - e[2] * along);
      return [along / 40, up / 40];
    });
    builder.face(pts, normal, uvs, color);
  }

  // Árboles: tronco y una copa hecha de dos masas irregulares, cada árbol con su tono.
  buildTrees(world, group) {
    const trees = world.scenery.trees;
    if (!trees.length) return;
    if (!this.treeGeo) {
      const trunk = new THREE.CylinderGeometry(0.75, 1, 1, 7);
      trunk.translate(0, 0.5, 0);
      const crown = new THREE.SphereGeometry(1, 12, 9);
      const p = crown.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const bump = 1 + 0.16 * Math.sin(x * 5.1 + y * 3.3) * Math.cos(z * 4.7 - y * 2.1) + 0.08 * Math.sin(z * 9.3 + x * 7.7);
        p.setXYZ(i, x * bump, y * bump * 0.88, z * bump);
      }
      crown.computeVertexNormals();
      this.treeGeo = { trunk, crown };
    }
    const trunks = new THREE.InstancedMesh(this.treeGeo.trunk, this.mat.trunk, trees.length);
    const crowns = new THREE.InstancedMesh(this.treeGeo.crown, this.mat.crown, trees.length * 2);
    const tones = ["#3f7a34", "#5a8f3a", "#356b2e", "#4d8540"].map((c) => new THREE.Color(c));
    const d = this.dummy;
    trees.forEach((t, i) => {
      const hash = (Math.imul(Math.round(t.x), 73856093) ^ Math.imul(Math.round(t.y), 19349663)) >>> 0;
      const r = t.r * 1.15;
      const trunkH = 13 + r * 0.55;
      d.position.set(t.x, 0, t.y);
      d.rotation.set(0, 0, 0);
      d.scale.set(2.6 + r * 0.07, trunkH + r * 0.4, 2.6 + r * 0.07);
      d.updateMatrix();
      trunks.setMatrixAt(i, d.matrix);
      const tone = tones[(t.tone * 2 + (hash % 2)) % tones.length];
      const shade = 0.85 + ((hash >>> 4) % 100) / 330;
      d.position.set(t.x, trunkH + r * 0.75, t.y);
      d.rotation.set(0, (hash % 628) / 100, 0);
      d.scale.set(r, r * 1.05, r);
      d.updateMatrix();
      crowns.setMatrixAt(i * 2, d.matrix);
      crowns.setColorAt(i * 2, this.tmpColor.copy(tone).multiplyScalar(shade));
      const a = ((hash >>> 8) % 628) / 100;
      d.position.set(t.x + Math.cos(a) * r * 0.5, trunkH + r * 1.25, t.y + Math.sin(a) * r * 0.5);
      d.rotation.set(0, a, 0);
      d.scale.set(r * 0.68, r * 0.68, r * 0.68);
      d.updateMatrix();
      crowns.setMatrixAt(i * 2 + 1, d.matrix);
      crowns.setColorAt(i * 2 + 1, this.tmpColor.copy(tone).multiplyScalar(shade * 1.12));
    });
    for (const mesh of [trunks, crowns]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.shared = true;
      group.add(mesh);
    }
  }

  // Farolas a lo largo de las calles, alternando de acera. De noche cada una deja un
  // charco de luz sobre la calzada.
  buildLamps(world, group) {
    const spots = [];
    let side = 1;
    for (const s of world.graph.segments) {
      if (s.type === "puente") continue;
      const len = distance(s.a, s.b);
      const u = unitVector(s.a, s.b);
      const n = { x: -u.y, y: u.x };
      const half = roadHalf(s);
      const from = ((world.degrees.get(s.a) || 0) > 2 ? world.nodeHalf.get(s.a) : 0) + 45;
      const to = len - ((world.degrees.get(s.b) || 0) > 2 ? world.nodeHalf.get(s.b) : 0) - 45;
      for (let t = from; t < to && spots.length < 500; t += V3.LAMP_GAP) {
        side = -side;
        spots.push({
          x: s.a.x + u.x * t + n.x * side * (half + 8),
          y: s.a.y + u.y * t + n.y * side * (half + 8),
          dir: { x: -n.x * side, y: -n.y * side },
          reach: half,
        });
      }
    }
    if (!this.lampGeo) {
      const pole = new THREE.CylinderGeometry(0.9, 1.4, 62, 8);
      pole.translate(0, 31, 0);
      const arm = new THREE.BoxGeometry(17, 1.3, 1.3);
      arm.translate(8, 62, 0);
      const head = new THREE.BoxGeometry(8, 1.6, 3.6);
      head.translate(15, 61.4, 0);
      const bulb = new THREE.BoxGeometry(6, 0.6, 2.6);
      bulb.translate(15, 60.4, 0);
      const pool = new THREE.PlaneGeometry(1, 1);
      pool.rotateX(-Math.PI / 2);
      this.lampGeo = { post: mergeGeometries([{ geo: pole }, { geo: arm }, { geo: head }]), bulb, pool };
    }
    const count = Math.max(1, spots.length);
    const posts = new THREE.InstancedMesh(this.lampGeo.post, this.mat.pole, count);
    const bulbs = new THREE.InstancedMesh(this.lampGeo.bulb, this.mat.bulb, count);
    const pools = new THREE.InstancedMesh(this.lampGeo.pool, this.mat.pool, count);
    const d = this.dummy;
    spots.forEach((p, i) => {
      d.position.set(p.x, 0, p.y);
      d.rotation.set(0, -Math.atan2(p.dir.y, p.dir.x), 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      posts.setMatrixAt(i, d.matrix);
      bulbs.setMatrixAt(i, d.matrix);
      d.position.set(p.x + p.dir.x * (p.reach * 0.6 + 8), V3.Y_TRAIL + 0.3, p.y + p.dir.y * (p.reach * 0.6 + 8));
      d.rotation.set(0, 0, 0);
      d.scale.set(230, 1, 230);
      d.updateMatrix();
      pools.setMatrixAt(i, d.matrix);
    });
    for (const mesh of [posts, bulbs, pools]) {
      mesh.count = spots.length;
      mesh.userData.shared = true;
      group.add(mesh);
    }
    posts.castShadow = true;
    pools.renderOrder = 1;
    return pools;
  }

  // Semáforos: poste en la acera derecha de cada acceso, con la cara hacia quien llega.
  buildSignals(world, group) {
    const list = [];
    for (const x of world.intersections) {
      for (const a of x.approaches) {
        list.push({
          intersection: x,
          approach: a,
          x: a.stop.x + a.right.x * (a.half + 9),
          y: a.stop.y + a.right.y * (a.half + 9),
          face: { x: -a.u.x, y: -a.u.y },
        });
      }
    }
    const holder = new THREE.Group();
    group.add(holder);
    if (!this.signalGeo) {
      const pole = new THREE.CylinderGeometry(1, 1.2, 46, 8);
      pole.translate(0, 23, 0);
      const box = new THREE.BoxGeometry(5, 19, 7);
      box.translate(0, 53, 0);
      this.signalGeo = { post: mergeGeometries([{ geo: pole }, { geo: box }]), lamp: new THREE.SphereGeometry(2.3, 12, 8) };
    }
    const count = Math.max(1, list.length);
    const posts = new THREE.InstancedMesh(this.signalGeo.post, this.mat.pole, count);
    posts.count = list.length;
    posts.castShadow = true;
    posts.userData.shared = true;
    holder.add(posts);
    const lamps = [0, 1, 2].map(() => {
      const mesh = new THREE.InstancedMesh(this.signalGeo.lamp, this.mat.lamp, count);
      mesh.count = list.length;
      mesh.userData.shared = true;
      holder.add(mesh);
      return mesh;
    });
    const d = this.dummy;
    list.forEach((s, i) => {
      d.position.set(s.x, 0, s.y);
      d.rotation.set(0, -Math.atan2(s.face.y, s.face.x), 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      posts.setMatrixAt(i, d.matrix);
      lamps.forEach((mesh, k) => {
        d.position.set(s.x + s.face.x * 2.4, 59 - k * 6, s.y + s.face.y * 2.4);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        mesh.setColorAt(i, this.tmpColor.setScalar(0.1));
      });
    });
    return { group: holder, list, lamps };
  }

  // ---------- Cada fotograma ----------
  resize(width, height, dpr) {
    this.renderer.setPixelRatio(this.small ? Math.min(dpr, 1.5) : dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.viewHeight = height;
  }

  heightOf(car) {
    const b = car.level;
    if (!b) return 0;
    const { a } = b.segment;
    return bridgeHeight((car.x - a.x) * b.u.x + (car.y - a.y) * b.u.y, b.len) + 1.7;
  }

  place(car, extra = 0) {
    const d = this.dummy;
    d.position.set(car.x, this.heightOf(car) + extra, car.y);
    d.rotation.set(0, -car.angle, 0);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    return d.matrix;
  }

  updateCars(sim) {
    const colors = this.colors;
    const leader = sim.leader;
    let g = 0;
    for (const car of sim.cars) {
      if (car === leader || g >= V3.MAX_GHOSTS) continue;
      this.ghosts.setMatrixAt(g, this.place(car));
      this.ghosts.setColorAt(g, this.tmpColor.set(car.damaged ? colors.wreck : colors.car));
      g++;
    }
    this.ghosts.count = g;
    this.ghosts.instanceMatrix.needsUpdate = true;
    if (this.ghosts.instanceColor) this.ghosts.instanceColor.needsUpdate = true;

    const detailed = [{ car: leader, color: leader.damaged ? colors.wreck : colors.leader }];
    if (sim.traffic) {
      for (const car of sim.traffic.cars) {
        if (detailed.length < V3.MAX_DETAILED) detailed.push({ car, color: colors.traffic[car.color] });
      }
    }
    let beams = 0;
    detailed.forEach(({ car, color }, i) => {
      const matrix = this.place(car);
      this.carPaint.setMatrixAt(i, matrix);
      this.carTrim.setMatrixAt(i, matrix);
      this.carLamps.setMatrixAt(i, matrix);
      this.carPaint.setColorAt(i, this.tmpColor.set(color));
      if (this.night && i > 0) {
        // Los faros del tráfico: un cono de luz pintado sobre el asfalto.
        const d = this.dummy;
        const reach = 150;
        d.position.set(car.x + Math.cos(car.angle) * (CAR_LENGTH / 2 + reach / 2), this.heightOf(car) + V3.Y_TRAIL + 0.5, car.y + Math.sin(car.angle) * (CAR_LENGTH / 2 + reach / 2));
        d.rotation.set(0, -car.angle, 0);
        d.scale.set(reach, 1, 110);
        d.updateMatrix();
        this.beams.setMatrixAt(beams++, d.matrix);
      }
    });
    for (const mesh of [this.carPaint, this.carTrim, this.carLamps]) {
      mesh.count = detailed.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.carPaint.instanceColor) this.carPaint.instanceColor.needsUpdate = true;
    this.beams.count = beams;
    this.beams.instanceMatrix.needsUpdate = true;

    if (this.night) {
      const dx = Math.cos(leader.angle), dz = Math.sin(leader.angle);
      const h = this.heightOf(leader);
      this.headlamp.position.set(leader.x + dx * 20, h + 9, leader.y + dz * 20);
      this.headlamp.target.position.set(leader.x + dx * 240, h, leader.y + dz * 240);
      this.headlamp.intensity = leader.damaged ? 0 : 9;
    }
  }

  updateWalkers(sim) {
    const walkers = sim.traffic ? sim.traffic.walkers : [];
    const d = this.dummy;
    const n = Math.min(walkers.length, V3.MAX_WALKERS);
    for (let i = 0; i < n; i++) {
      const w = walkers[i];
      d.position.set(w.x, 0, w.y);
      d.rotation.set(0, -w.angle, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.walkerBodies.setMatrixAt(i, d.matrix);
      this.walkerHeads.setMatrixAt(i, d.matrix);
      this.walkerBodies.setColorAt(i, this.tmpColor.set(this.colors.traffic[w.tone]));
    }
    this.walkerBodies.count = this.walkerHeads.count = n;
    this.walkerBodies.instanceMatrix.needsUpdate = this.walkerHeads.instanceMatrix.needsUpdate = true;
    if (this.walkerBodies.instanceColor) this.walkerBodies.instanceColor.needsUpdate = true;
  }

  updateSignals(sim) {
    const { list, lamps, group } = this.signals;
    if (!group.visible || !list.length) return;
    const frame = sim.traffic ? sim.traffic.frame : -1;
    const names = ["red", "yellow", "green"];
    list.forEach((s, i) => {
      const state = frame >= 0 ? lightState(s.intersection, s.approach, frame) : null;
      lamps.forEach((mesh, k) => {
        const on = state === names[k];
        mesh.setColorAt(i, this.tmpColor.copy(this.signalColors[k]).multiplyScalar(on ? 1.6 : 0.12));
      });
    });
    for (const mesh of lamps) mesh.instanceColor.needsUpdate = true;
  }

  updateSensors(leader) {
    const show = !leader.damaged && leader.sensor.rays.length > 0;
    this.rays.visible = this.hits.visible = show;
    if (!show) return;
    const h = this.heightOf(leader) + 7;
    const ray = this.rays.geometry.getAttribute("position");
    const hit = this.hits.geometry.getAttribute("position");
    let hits = 0;
    leader.sensor.rays.forEach(([start, end], i) => {
      const reading = leader.sensor.readings[i];
      const tip = reading || end;
      ray.setXYZ(i * 2, start.x, h, start.y);
      ray.setXYZ(i * 2 + 1, tip.x, h, tip.y);
      if (reading) hit.setXYZ(hits++, reading.x, h, reading.y);
    });
    ray.needsUpdate = true;
    hit.needsUpdate = true;
    this.hits.geometry.setDrawRange(0, hits);
  }

  // Las estelas se pintan en su propio lienzo; aquí ese lienzo es una textura tendida
  // sobre el asfalto. Subirlo entero a la tarjeta gráfica cuesta (unos 25 ms en un barrio
  // real), así que solo se suben las baldosas que cambiaron desde la última vez.
  updateTrails(trails, sim) {
    const layer = trails && trails.world === sim.world && trails.box ? trails.layers[0] : null;
    this.trailPlane.visible = !!layer;
    this.pathMesh.visible = false;
    if (!layer) return;
    if (this.trailCanvas !== layer.canvas) {
      if (this.mat.trail.map) this.mat.trail.map.dispose();
      const t = new THREE.CanvasTexture(layer.canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.flipY = false;
      this.mat.trail.map = t;
      this.mat.trail.needsUpdate = true;
      this.trailCanvas = layer.canvas;
      const { x, y, w, h } = trails.box;
      this.trailPlane.position.set(x + w / 2, V3.Y_TRAIL, y + h / 2);
      this.trailPlane.scale.set(w, 1, h);
      if (!this.trailPlane.parent) this.scene.add(this.trailPlane);
      if (trails.dirty) {
        trails.dirty.clear();
        trails.dirtyAll = false;
      }
    } else if (this.frame % 2 === 0) this.uploadTrails(trails, layer.canvas);

    // Recorrido del líder, como una cinta estrecha por encima de las estelas.
    const i = trails.cars ? trails.cars.indexOf(sim.leader) : -1;
    if (i < 0) return;
    const path = trails.paths[i];
    const count = Math.min(Math.floor(path.length / 3) + 1, this.pathMax);
    if (count < 2) return;
    const pos = this.pathMesh.geometry.getAttribute("position");
    const first = Math.floor(path.length / 3) + 1 - count;
    const point = (k) => {
      const j = (first + k) * 3;
      return j < path.length ? [path[j], path[j + 1]] : [sim.leader.x, sim.leader.y];
    };
    const y = this.heightOf(sim.leader) + V3.Y_TRAIL + 0.6;
    for (let k = 0; k < count; k++) {
      const p = point(k);
      const a = point(Math.max(0, k - 1));
      const b = point(Math.min(count - 1, k + 1));
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (-(b[1] - a[1]) / len) * 1.1;
      const nz = ((b[0] - a[0]) / len) * 1.1;
      pos.setXYZ(k * 2, p[0] + nx, y, p[1] + nz);
      pos.setXYZ(k * 2 + 1, p[0] - nx, y, p[1] - nz);
    }
    pos.needsUpdate = true;
    this.pathMesh.geometry.setDrawRange(0, (count - 1) * 6);
    this.pathMesh.visible = true;
  }

  uploadTrails(trails, canvas) {
    const map = this.mat.trail.map;
    if (!trails.dirty) {
      map.needsUpdate = true; // trails.js de una versión anterior: no anota los cambios
      return;
    }
    if (trails.dirtyAll || trails.dirty.size > 48) map.needsUpdate = true;
    else {
      const tile = this.tileCanvas;
      const ctx = tile.getContext("2d");
      for (const key of trails.dirty) {
        const sx = (key % 4096) * TRAIL_TILE;
        const sy = Math.floor(key / 4096) * TRAIL_TILE;
        const w = Math.min(TRAIL_TILE, canvas.width - sx);
        const h = Math.min(TRAIL_TILE, canvas.height - sy);
        if (w <= 0 || h <= 0) continue;
        if (tile.width !== w || tile.height !== h) {
          tile.width = w;
          tile.height = h;
        } else ctx.clearRect(0, 0, w, h);
        ctx.drawImage(canvas, sx, sy, w, h, 0, 0, w, h);
        this.renderer.copyTextureToTexture(this.tileAt.set(sx, sy), this.tileTexture, map);
      }
    }
    trails.dirty.clear();
    trails.dirtyAll = false;
  }

  // Siguiendo al líder, la cámara va detrás y por encima de su coche y gira con él
  // sin sacudidas. Sin seguirlo, mira el mapa desde lo alto, centrada en view.x, view.y.
  updateCamera({ sim, view, follow, speed, driveZoom }) {
    const leader = sim.leader;
    const ease = (k) => (this.camReady ? 1 - Math.pow(1 - k, Math.max(1, speed)) : 1);
    let pos;
    let target;
    if (follow) {
      const scale = clamp(driveZoom / view.zoom, 0.35, 6);
      if (Math.abs(leader.speed) > 0.3 || !this.camReady) {
        let turn = leader.angle - this.camHeading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.camHeading += turn * ease(0.05);
      }
      const dx = Math.cos(this.camHeading), dz = Math.sin(this.camHeading);
      const h = this.heightOf(leader);
      pos = new THREE.Vector3(leader.x - dx * 175 * scale, h + 16 + 82 * scale, leader.y - dz * 175 * scale);
      target = new THREE.Vector3(leader.x + dx * 55, h + 8, leader.y + dz * 55);
      this.camPos.lerp(pos, ease(0.09));
      this.camTarget.lerp(target, ease(0.14));
    } else {
      const d = (1.0 * this.viewHeight) / view.zoom / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      const pitch = 0.95; // ≈ 54° sobre el horizonte
      // En perspectiva la mitad cercana del mapa ocupa más pantalla que la lejana:
      // se mira un poco más acá del centro para que el mapa quede centrado.
      const near = d * 0.09;
      target = new THREE.Vector3(view.x, 0, view.y + near);
      pos = new THREE.Vector3(view.x, d * Math.sin(pitch), view.y + near + d * Math.cos(pitch));
      this.camPos.lerp(pos, ease(0.25));
      this.camTarget.lerp(target, ease(0.25));
      this.camHeading = -Math.PI / 2;
    }
    this.camReady = true;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.sky.position.copy(this.camPos);

    // La niebla y las sombras se ajustan a lo lejos que está la cámara.
    const dist = this.camPos.distanceTo(this.camTarget);
    this.scene.fog.near = 1400 + dist * 1.6;
    this.scene.fog.far = 9000 + dist * 4;
    const size = clamp(dist * 1.5, 520, 5200);
    if (Math.abs(size - this.shadowSize) > this.shadowSize * 0.08) {
      this.shadowSize = size;
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -size;
      cam.right = cam.top = size;
      cam.near = 100;
      cam.far = 9000;
      cam.updateProjectionMatrix();
    }
    // El resplandor solo acompaña de cerca: desde lo alto se vería como un foco en el césped.
    this.glow.position.set(this.camTarget.x, 130, this.camTarget.z);
    this.glow.intensity = this.night ? 1.1 * clamp(1 - (dist - 500) / 900, 0, 1) : 0;
    this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunOffset, 4000);
  }

  render(state) {
    this.frame++;
    const { sim } = state;
    this.updateCars(sim);
    this.updateWalkers(sim);
    this.updateSignals(sim);
    this.updateSensors(sim.leader);
    this.updateTrails(state.trails, sim);
    this.updateCamera(state);
    this.renderer.render(this.scene, this.camera);
  }
}
