"use strict";
// La ciudad de la vista 3D: cada barrio real con sus edificios y su monumento, y la
// vida de la calle (árboles en las aceras, bancos, papeleras, buzones, paradas de
// autobús y gente paseando). Son métodos que se añaden a View3D.

// Estilos de edificación. floors(b, hash) da los pisos de cada edificio; flat(hash)
// dice si lleva azotea en vez de tejado; glass: fachada acristalada desde 8 pisos;
// wide y deep: cuánto más ancho y más hondo es el edificio que la casa del paisaje (en
// los barrios densos llenan la manzana); treeGap: cada cuántas unidades hay un árbol
// en la acera (both: en las dos).
const CITY = {
  suburb: {
    walls: ["#f2efe6", "#ece2cf", "#e9d9c3", "#f4e6c8", "#dfe5e8", "#e8cdbb", "#d9d2c5", "#f0f0ee"],
    roofs: ["#b5573a", "#5f6b75", "#8a6a4a"],
    flat: (hash) => hash % 5 === 0,
    floors: (b, hash) => (hash % 5 === 0 ? 2 + (hash % 7 === 0 ? 1 : 0) : b.height > 0.72 ? 2 : 1),
    treeGap: 380,
  },
  // Condesa (CDMX): casas y edificios bajos de colores, mucha azotea y mucho árbol.
  condesa: {
    walls: ["#f1e3c8", "#e8c9b0", "#cfe0d4", "#f4efe6", "#e6b8a2", "#d7dfe8", "#e9d58f", "#c9a48f"],
    roofs: ["#b5573a", "#a3523a"],
    flat: (hash) => hash % 5 < 3,
    floors: (b, hash) => 2 + (hash % 4),
    wide: 1.15, deep: 1.3,
    treeGap: 150, both: true, park: true,
  },
  // Centro Histórico (CDMX): fachadas coloniales de tezontle y cantera, todo azoteas.
  centro: {
    walls: ["#9c4a3c", "#d9a441", "#e8d9b8", "#c97b63", "#f0e2c4", "#b5574a", "#d8c7a4"],
    flatRoof: "#9a8b7a",
    flat: () => true,
    floors: (b, hash) => 2 + (hash % 3),
    wide: 1.45, deep: 2,
    treeGap: 0, flag: true,
  },
  // Eixample (Barcelona): manzanas de la misma altura, en tonos de piedra cálida.
  eixample: {
    walls: ["#e6d3b3", "#dcc7a3", "#e9dcc3", "#d9b99a", "#e3cfae", "#ead9c0"],
    flatRoof: "#a5947f",
    flat: () => true,
    floors: (b, hash) => 5 + (hash % 3),
    wide: 1.5, deep: 2.4,
    treeGap: 130, both: true,
  },
  // L'Étoile (París): piedra clara y tejados grises de zinc, con el Arco en la glorieta.
  etoile: {
    walls: ["#ece4d2", "#e6dcc6", "#f0e9da", "#e2d8c2"],
    roofs: ["#69727d", "#5d6670"],
    flat: () => false,
    floors: (b, hash) => 5 + (hash % 2),
    rise: 0.16,
    wide: 1.5, deep: 2.2,
    treeGap: 120, both: true, arch: true,
  },
  // Midtown (Nueva York): torres de oficinas, la mayoría acristaladas, y un rascacielos.
  manhattan: {
    walls: ["#8fa3b5", "#9aa7ae", "#b8a48c", "#7d8c99", "#a9b4bb", "#6f7f8f", "#c2b59f"],
    flatRoof: "#5b6066",
    flat: () => true,
    floors: (b, hash) => (hash % 11 === 0 ? 30 + (hash % 16) : 6 + (hash % 16)),
    wide: 1.5, deep: 3.2,
    glass: true, tower: true,
    treeGap: 260,
  },
};

Object.assign(View3D.prototype, {
  // Fachada acristalada de las torres: un atlas de 4 × 4 paños de vidrio, y el mismo
  // reparto con las oficinas que tienen la luz encendida.
  makeCityParts() {
    const rng = seededRandom(11);
    const lit = Array.from({ length: 16 }, () => rng() < 0.38);
    const shade = Array.from({ length: 16 }, () => rng());
    const cell = 64;
    this.tex.tower = this.texture(cell * 4, (ctx, s) => {
      ctx.fillStyle = "#dfe3e6";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 16; i++) {
        const x = (i % 4) * cell, y = Math.floor(i / 4) * cell;
        const g = ctx.createLinearGradient(x, y, x + cell, y + cell);
        g.addColorStop(0, shade[i] > 0.5 ? "#7f9db8" : "#5d7c98");
        g.addColorStop(1, "#33485c");
        ctx.fillStyle = g;
        ctx.fillRect(x + 4, y + 5, cell - 8, cell - 16);
        ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
        ctx.fillRect(x + 4, y + 5, (cell - 8) * 0.45, cell - 16);
      }
    });
    this.tex.towerLit = this.texture(cell * 4, (ctx, s) => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 16; i++) {
        if (!lit[i]) continue;
        ctx.fillStyle = shade[i] > 0.6 ? "#fff1cf" : "#ffd58a";
        ctx.fillRect((i % 4) * cell + 4, Math.floor(i / 4) * cell + 5, cell - 8, cell - 16);
      }
    });
    const std = (options) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...options });
    this.mat.towers = std({
      map: this.tex.tower, emissiveMap: this.tex.towerLit, emissive: 0xffe2b0, emissiveIntensity: this.mat.walls.emissiveIntensity,
      vertexColors: true, roughness: 0.22, metalness: 0.45, envMap: this.mat.paint.envMap, envMapIntensity: 0.9,
    });
    this.mat.stone = std({ color: 0xd9cfbb, roughness: 0.85 });
    this.mat.legs = std({ color: 0x2a2f3a, roughness: 0.9 });
    this.mat.water = std({ color: 0x4f8fb5, roughness: 0.12, metalness: 0.3, envMap: this.mat.paint.envMap });
  },

  // El punto del mapa más alejado de cualquier calle: ahí va la plaza o el parque.
  openSpot(world) {
    const box = boundsOf(world.graph.points);
    let best = null;
    for (let i = 1; i < 16; i++) {
      for (let j = 1; j < 16; j++) {
        const p = { x: lerp(box.minX, box.maxX, i / 16), y: lerp(box.minY, box.maxY, j / 16) };
        let gap = Infinity;
        for (const s of world.graph.segments) gap = Math.min(gap, projectOnSegment(p, s.a, s.b).dist - roadHalf(s));
        if (!best || gap > best.gap) best = { x: p.x, y: p.y, gap };
      }
    }
    return best;
  },

  // Qué se construye en este mapa además de las casas: dónde va el monumento, qué zona
  // hay que dejar libre de edificios y árboles, y qué edificio pasa a ser el rascacielos.
  cityPlan(world, style) {
    const plan = { clear: null, tower: null, spot: null };
    if (!world.graph.segments.length) return plan;
    if (style.arch) {
      const ring = world.graph.segments.filter((s) => s.type === "glorieta");
      if (ring.length) {
        const points = ring.flatMap((s) => [s.a, s.b]);
        const c = { x: points.reduce((t, p) => t + p.x, 0) / points.length, y: points.reduce((t, p) => t + p.y, 0) / points.length };
        const radius = points.reduce((t, p) => t + distance(p, c), 0) / points.length;
        plan.spot = { x: c.x, y: c.y, gap: radius - ROAD_WIDTH / 2 - V3.SIDEWALK };
        plan.clear = { x: c.x, y: c.y, r: radius - ROAD_WIDTH / 2 };
      }
    } else if (style.flag || style.park) {
      plan.spot = this.openSpot(world);
      if (plan.spot) plan.clear = { x: plan.spot.x, y: plan.spot.y, r: style.flag ? Math.min(240, plan.spot.gap * 0.6) : 55 };
    } else if (style.tower) {
      const box = boundsOf(world.graph.points);
      const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      for (const b of world.scenery.buildings) {
        if (!plan.tower || distance(b.c, c) < distance(plan.tower.c, c)) plan.tower = b;
      }
    }
    return plan;
  },

  // La planta del edificio que se levanta en el solar de una casa del paisaje: en los
  // barrios densos es más ancha y crece hacia el fondo de la manzana, hasta donde no
  // pise otra calle.
  massing(world, lot, style) {
    const wide = style.wide || 1;
    let deep = style.deep || 1;
    if (wide === 1 && deep === 1) return lot;
    let near = null;
    for (const s of world.graph.segments) {
      const p = projectOnSegment(lot.c, s.a, s.b);
      if (!near || p.dist < near.dist) near = p;
    }
    const gap = near.dist || 1;
    const out = { x: (lot.c.x - near.point.x) / gap, y: (lot.c.y - near.point.y) / gap }; // de la calle hacia el fondo
    const fits = (reach) => {
      const p = { x: lot.c.x + out.x * reach, y: lot.c.y + out.y * reach };
      return world.graph.segments.every((s) => projectOnSegment(p, s.a, s.b).dist > roadHalf(s) + 26);
    };
    while (deep > 1 && !fits(lot.d * (deep - 0.5))) deep = Math.max(1, deep - 0.6);
    const w = lot.w * wide;
    const d = lot.d * deep;
    const shift = (d - lot.d) / 2;
    const c = { x: lot.c.x + out.x * shift, y: lot.c.y + out.y * shift };
    const u = lot.u;
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([i, j]) => ({
      x: c.x + u.x * i - u.y * j,
      y: c.y + u.y * i + u.x * j,
    }));
    return { c, u, w, d, corners, radius: Math.hypot(w, d) / 2, roof: lot.roof, height: lot.height };
  },

  // Edificios según el estilo del barrio: paredes con ventanas (o acristaladas, en las
  // torres), tejado a cuatro aguas con alero y chimenea, o azotea con pretil.
  buildHouses(world, group, styleName, plan) {
    if (!this.mat.towers) this.makeCityParts();
    const style = CITY[styleName];
    const walls = new MeshBuilder();
    const towers = new MeshBuilder();
    const roofs = new MeshBuilder();
    const wallTones = style.walls.map((c) => new THREE.Color(c));
    const roofTones = (style.roofs || V3.ROOFS).map((c) => new THREE.Color(c));
    const flatTone = new THREE.Color(style.flatRoof || "#8f918c");
    const brick = new THREE.Color("#8c4a3a");
    const metal = new THREE.Color("#6d7379");

    // Un cuerpo del edificio: cuatro fachadas de y0 a y1, con la planta reducida a `k`.
    const body = (builder, b, k, y0, y1, tone, hash) => {
      const u = b.u;
      const n = { x: -u.y, y: u.x };
      const corners = b.corners.map((p) => lerpPoint(b.c, p, k));
      const normals = [[-n.x, 0, -n.y], [u.x, 0, u.y], [n.x, 0, n.y], [-u.x, 0, -u.y]];
      const floors = Math.max(1, Math.round((y1 - y0) / V3.FLOOR));
      corners.forEach((p, i) => {
        const q = corners[(i + 1) % 4];
        const bays = Math.max(1, Math.round(distance(p, q) / V3.BAY));
        const u0 = ((hash >>> (i * 2)) % 4) / 4;
        const v0 = ((hash >>> (i * 2 + 8)) % 4) / 4;
        builder.face(
          [[p.x, y0, p.y], [q.x, y0, q.y], [q.x, y1, q.y], [p.x, y1, p.y]], normals[i],
          [[u0, v0], [u0 + bays / 4, v0], [u0 + bays / 4, v0 + floors / 4], [u0, v0 + floors / 4]], tone
        );
      });
      return corners;
    };
    const lid = (corners, y, tone) => {
      roofs.face(corners.map((p) => [p.x, y, p.y]), [0, 1, 0], [[0, 0], [2, 0], [2, 2], [0, 2]], tone);
    };

    for (const lot of world.scenery.buildings) {
      lot.top3d = undefined; // hasta dónde llega, con tejado (lo usa la cámara)
      lot.mass = null;
      if (plan.clear && distance(lot.c, plan.clear) < plan.clear.r + lot.radius) continue; // sitio del monumento
      const hash = (Math.imul(Math.round(lot.c.x), 73856093) ^ Math.imul(Math.round(lot.c.y), 19349663)) >>> 0;
      const b = (lot.mass = this.massing(world, lot, style));
      const tone = wallTones[(hash >>> 3) % wallTones.length];
      const u = b.u;
      const n = { x: -u.y, y: u.x };
      const at = (i, j, y) => [b.c.x + u.x * i + n.x * j, y, b.c.y + u.y * i + n.y * j];

      if (lot === plan.tower) {
        // El rascacielos: cuerpos cada vez más estrechos y una aguja.
        let y = 0;
        for (const [k, floors] of [[1.25, 36], [0.95, 16], [0.62, 12], [0.34, 7]]) {
          const top = y + floors * V3.FLOOR;
          lid(body(towers, b, k, y, top, tone, hash), top, flatTone);
          y = top;
        }
        roofs.box(b.c, u, 4, 4, y, y + 380, metal);
        lot.top3d = y + 380;
        continue;
      }

      const flat = style.flat(hash);
      const floors = style.floors(b, hash);
      const H = floors * V3.FLOOR + 3;
      const glass = style.glass && floors >= 8;
      body(glass ? towers : walls, b, 1, 0, H, tone, hash);
      lot.top3d = flat ? H + 4 : H + Math.min(b.w, b.d) * (style.rise || 0.3);

      if (flat) {
        const hw = b.w / 2, hd = b.d / 2;
        roofs.face([at(-hw, -hd, H), at(hw, -hd, H), at(hw, hd, H), at(-hw, hd, H)], [0, 1, 0], [[0, 0], [b.w / 40, 0], [b.w / 40, b.d / 40], [0, b.d / 40]], flatTone);
        // Pretil alrededor y, en los edificios altos, el cuarto de máquinas.
        for (const [cx, cy, lu, ln] of [[0, -hd + 1.5, hw, 1.5], [0, hd - 1.5, hw, 1.5], [-hw + 1.5, 0, 1.5, hd], [hw - 1.5, 0, 1.5, hd]]) {
          const c = { x: b.c.x + u.x * cx + n.x * cy, y: b.c.y + u.y * cx + n.y * cy };
          (glass ? towers : walls).box(c, u, lu, ln, H, H + 4, tone);
        }
        if (floors >= 5 && hash % 2 === 0) {
          const c = { x: b.c.x + u.x * b.w * 0.15, y: b.c.y + u.y * b.w * 0.15 };
          roofs.box(c, u, b.w * 0.22, b.d * 0.22, H, H + 14, metal);
          if (floors >= 24) roofs.box(c, u, 1.5, 1.5, H + 14, H + 14 + floors * 3, metal);
          lot.top3d = H + 14;
        }
        continue;
      }
      const over = 5; // alero
      const hw = b.w / 2 + over, hd = b.d / 2 + over;
      const alongU = b.w >= b.d;
      const rise = Math.min(b.w, b.d) * (style.rise || 0.3);
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
    for (const [builder, material] of [[walls, this.mat.walls], [towers, this.mat.towers], [roofs, this.mat.roofs]]) {
      if (builder.empty) continue;
      const mesh = new THREE.Mesh(builder.geometry(), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  },

  // El monumento de cada barrio. Devuelve los árboles que añade (el parque).
  buildLandmark(world, group, styleName, plan) {
    const style = CITY[styleName];
    const spot = plan.spot;
    const trees = [];
    if (!spot || spot.gap < 90) return trees;
    const add = (geo, material, cast = true) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    if (style.arch) {
      // Arco del Triunfo: un bloque de piedra con el gran arco en medio, y su ático.
      const w = Math.min(480, spot.gap * 0.95);
      const h = w * 1.08, d = w * 0.46;
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(w / 2, h);
      shape.lineTo(-w / 2, h);
      shape.closePath();
      const hole = new THREE.Path();
      const aw = w * 0.3, ah = h * 0.36;
      hole.moveTo(-aw / 2, 0);
      hole.lineTo(-aw / 2, ah);
      hole.absarc(0, ah, aw / 2, Math.PI, 0, true);
      hole.lineTo(aw / 2, 0);
      hole.closePath();
      shape.holes.push(hole);
      const arch = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 18 });
      arch.translate(0, 0, -d / 2);
      add(arch, this.mat.stone).position.set(spot.x, 0, spot.y);
      const cornice = new THREE.BoxGeometry(w * 1.06, h * 0.05, d * 1.1);
      for (const y of [h * 0.72, h * 1.02]) add(cornice, this.mat.stone).position.set(spot.x, y, spot.y);
      const plaza = new MeshBuilder();
      const ring = [];
      for (let i = 0; i < 28; i++) ring.push({ x: spot.x + Math.cos((i / 28) * Math.PI * 2) * spot.gap, y: spot.y + Math.sin((i / 28) * Math.PI * 2) * spot.gap });
      plaza.flat(this.orient(ring), V3.Y_SIDEWALK, new THREE.Color("#ffffff"), 60);
      add(plaza.geometry(), this.mat.sidewalk, false);
    } else if (style.flag) {
      // La plaza con su asta y la bandera.
      const half = Math.min(230, spot.gap * 0.55);
      const plaza = new MeshBuilder();
      plaza.flat(this.orient([{ x: spot.x - half, y: spot.y - half }, { x: spot.x + half, y: spot.y - half }, { x: spot.x + half, y: spot.y + half }, { x: spot.x - half, y: spot.y + half }]), V3.Y_SIDEWALK, new THREE.Color("#ffffff"), 60);
      add(plaza.geometry(), this.mat.sidewalk, false);
      const pole = new THREE.CylinderGeometry(2.2, 3.4, 420, 10);
      pole.translate(0, 210, 0);
      add(pole, this.mat.pole).position.set(spot.x, 0, spot.y);
      const flag = new MeshBuilder();
      const bands = ["#0b6b3a", "#f4f4ef", "#c5202c"].map((c) => new THREE.Color(c));
      bands.forEach((tone, i) => {
        const x0 = spot.x + 3 + i * 62, x1 = x0 + 62;
        flag.face([[x0, 290, spot.y], [x1, 290, spot.y], [x1, 410, spot.y], [x0, 410, spot.y]], [0, 0, 1], null, tone);
      });
      add(flag.geometry(), this.mat.parts);
    } else if (style.park) {
      // El parque: una fuente y una arboleda alrededor.
      const basin = new THREE.CylinderGeometry(46, 50, 7, 28);
      basin.translate(0, 3.5, 0);
      add(basin, this.mat.stone).position.set(spot.x, 0, spot.y);
      const water = new THREE.CylinderGeometry(42, 42, 1, 28);
      water.translate(0, 7.2, 0);
      add(water, this.mat.water, false).position.set(spot.x, 0, spot.y);
      const jet = new THREE.CylinderGeometry(2.5, 5, 26, 10);
      jet.translate(0, 13, 0);
      add(jet, this.mat.stone).position.set(spot.x, 0, spot.y);
      const rng = seededRandom(73);
      const reach = Math.min(420, spot.gap - 150);
      for (let i = 0; i < 46 && reach > 80; i++) {
        const a = rng() * Math.PI * 2;
        const r = 75 + rng() * (reach - 75);
        trees.push({ x: spot.x + Math.cos(a) * r, y: spot.y + Math.sin(a) * r, r: 13 + rng() * 11, tone: i % 2 });
      }
    }
    return trees;
  },

  // Árboles en las aceras, más o menos seguidos según el barrio.
  streetTrees(world, styleName) {
    const style = CITY[styleName];
    const out = [];
    if (!style.treeGap) return out;
    let turn = 0;
    for (const s of world.graph.segments) {
      if (s.type === "puente") continue;
      const len = distance(s.a, s.b);
      const u = unitVector(s.a, s.b);
      const n = { x: -u.y, y: u.x };
      const half = roadHalf(s);
      const from = ((world.degrees.get(s.a) || 0) > 2 ? world.nodeHalf.get(s.a) : 0) + 70;
      const to = len - ((world.degrees.get(s.b) || 0) > 2 ? world.nodeHalf.get(s.b) : 0) - 70;
      for (let t = from + style.treeGap / 2; t < to && out.length < 700; t += style.treeGap) {
        for (const side of style.both ? [1, -1] : [turn++ % 2 ? 1 : -1]) {
          out.push({ x: s.a.x + u.x * t + n.x * side * (half + 11), y: s.a.y + u.y * t + n.y * side * (half + 11), r: 8.5 + ((t * 7.3) % 3), tone: (turn + side) & 1 });
        }
      }
    }
    return out;
  },

  // Mobiliario de las aceras: bancos, papeleras, bocas de incendio, buzones y, de vez
  // en cuando, una parada de autobús.
  buildFurniture(world, group) {
    const m = new MeshBuilder();
    const tone = (c) => new THREE.Color(c);
    const wood = tone("#8a6a45"), iron = tone("#2f3336"), green = tone("#2f6b45"), red = tone("#c23a2e");
    const blue = tone("#2f5fa8"), glass = tone("#9fc3d6"), white = tone("#ecece6");
    let k = 0;
    for (const s of world.graph.segments) {
      if (s.type === "puente") continue;
      const len = distance(s.a, s.b);
      const u = unitVector(s.a, s.b);
      const n = { x: -u.y, y: u.x };
      const half = roadHalf(s);
      const from = ((world.degrees.get(s.a) || 0) > 2 ? world.nodeHalf.get(s.a) : 0) + 95;
      const to = len - ((world.degrees.get(s.b) || 0) > 2 ? world.nodeHalf.get(s.b) : 0) - 95;
      for (let t = from; t < to && k < 420; t += 255) {
        const side = k % 2 ? 1 : -1;
        const out = { x: n.x * side, y: n.y * side }; // de la calzada hacia las casas
        const at = (along, away) => ({ x: s.a.x + u.x * (t + along) + out.x * (half + away), y: s.a.y + u.y * (t + along) + out.y * (half + away) });
        const kind = k++ % 9;
        if (kind === 4 && to - t > 60) {
          // Parada de autobús: marquesina con banco y poste.
          m.box(at(0, 9), u, 21, 6, 26, 27.5, iron);
          m.box(at(0, 13.5), u, 21, 0.4, 3, 26, glass);
          for (const end of [-20, 20]) m.box(at(end, 5), u, 0.7, 0.7, 0, 26, iron);
          m.box(at(0, 11.5), u, 13, 2, 4.4, 5.6, wood);
          m.box(at(-27, 5), u, 0.6, 0.6, 0, 30, iron);
          m.box(at(-27, 5), u, 0.4, 4.5, 24, 31, blue);
        } else if (kind % 4 === 0) {
          m.box(at(0, 11.5), u, 9, 2.6, 4.2, 5.4, wood); // banco
          m.box(at(0, 13.8), u, 9, 0.5, 5.4, 10.5, wood);
          for (const end of [-7.5, 7.5]) m.box(at(end, 11.5), u, 0.6, 2.4, 0, 4.2, iron);
        } else if (kind % 4 === 1) {
          m.box(at(0, 4.5), u, 2.5, 2.5, 0, 9, green); // papelera
        } else if (kind % 4 === 2) {
          m.box(at(0, 4), u, 1.6, 1.6, 0, 6.5, red); // boca de incendio
          m.box(at(0, 4), u, 2.3, 2.3, 4.4, 5.4, red);
        } else {
          m.box(at(0, 12), u, 0.8, 0.8, 0, 9, iron); // buzón
          m.box(at(0, 12), u, 3, 2.2, 9, 14, blue);
          m.box(at(0, 12), u, 2.2, 2.3, 12, 12.8, white);
        }
      }
    }
    if (m.empty) return;
    const mesh = new THREE.Mesh(m.geometry(), this.mat.parts);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  },

  // Gente que pasea por las aceras, de una punta a otra de su calle y vuelta. No forma
  // parte de la simulación: los peatones que cruzan son otros.
  buildStrollers(world) {
    const list = [];
    const rng = seededRandom(mapSeed(world.graph) ^ 0x51f3);
    const max = this.small ? 50 : 130;
    for (const s of world.graph.segments) {
      if (s.type === "puente" || list.length >= max) continue;
      const len = distance(s.a, s.b);
      const from = ((world.degrees.get(s.a) || 0) > 2 ? world.nodeHalf.get(s.a) : 0) + 30;
      const span = len - ((world.degrees.get(s.b) || 0) > 2 ? world.nodeHalf.get(s.b) : 0) - 30 - from;
      if (span < 120 || rng() < 0.45) continue;
      const u = unitVector(s.a, s.b);
      const side = rng() < 0.5 ? 1 : -1;
      const off = roadHalf(s) + 4.5 + rng() * 3;
      list.push({
        x: s.a.x + u.x * from - u.y * side * off,
        y: s.a.y + u.y * from + u.x * side * off,
        u, span, angle: Math.atan2(u.y, u.x),
        phase: rng() * span * 2, speed: 0.45 + rng() * 0.4, tone: Math.floor(rng() * 4),
      });
    }
    return list;
  },

  makeWalkerParts() {
    const torso = new THREE.CapsuleGeometry(2.6, 4.6, 4, 10);
    torso.translate(0, 11.4, 0);
    this.walkerBodies.geometry.dispose();
    this.walkerBodies.geometry = torso;
    const leg = new THREE.BoxGeometry(1.8, 7.8, 1.8);
    leg.translate(0, -3.9, 0); // el origen queda en la cadera
    this.walkerLegs = new THREE.InstancedMesh(leg, this.mat.legs, V3.MAX_WALKERS * 2);
    this.walkerLegs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.walkerLegs.frustumCulled = false;
    this.walkerLegs.castShadow = true;
    this.walkerLegs.count = 0;
    this.scene.add(this.walkerLegs);
    this.walkClock = 0;
  },

  // Peatones que cruzan (los de la simulación) y gente que pasea, todos moviendo las piernas.
  updateWalkers(sim, state) {
    if (!this.walkerLegs) this.makeWalkerParts();
    this.walkClock += state.steps;
    const d = this.dummy;
    const hip = this.wheelDummy;
    let n = 0;
    const put = (x, y, angle, stride, tone) => {
      if (n >= V3.MAX_WALKERS) return;
      d.position.set(x, 0, y);
      d.rotation.set(0, -angle, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      const base = this.carMatrix.copy(d.matrix);
      this.walkerBodies.setMatrixAt(n, base);
      this.walkerHeads.setMatrixAt(n, base);
      this.walkerBodies.setColorAt(n, this.tmpColor.set(this.colors.traffic[tone]));
      const swing = Math.sin(stride) * 0.55;
      for (const side of [1, -1]) {
        hip.position.set(0, 7.8, side * 1.3);
        hip.rotation.set(0, 0, swing * side);
        hip.scale.set(1, 1, 1);
        hip.updateMatrix();
        this.walkerLegs.setMatrixAt(n * 2 + (side > 0 ? 0 : 1), this.tmpMatrix.multiplyMatrices(base, hip.matrix));
      }
      n++;
    };
    if (sim.traffic) for (const w of sim.traffic.walkers) put(w.x, w.y, w.angle, (w.x + w.y) * 0.24, w.tone);
    for (const s of this.strollers || []) {
      const lap = (s.phase + this.walkClock * s.speed) % (s.span * 2);
      const t = lap < s.span ? lap : s.span * 2 - lap;
      put(s.x + s.u.x * t, s.y + s.u.y * t, lap < s.span ? s.angle : s.angle + Math.PI, lap * 0.24, s.tone);
    }
    this.walkerBodies.count = this.walkerHeads.count = n;
    this.walkerLegs.count = n * 2;
    for (const mesh of [this.walkerBodies, this.walkerHeads, this.walkerLegs]) mesh.instanceMatrix.needsUpdate = true;
    if (this.walkerBodies.instanceColor) this.walkerBodies.instanceColor.needsUpdate = true;
  },
});
