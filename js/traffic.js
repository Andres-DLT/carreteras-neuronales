"use strict";
// Tráfico, semáforos y peatones. Todo es determinista dentro de una generación
// (misma semilla y mismos tiempos), así el mejor cerebro repite exactamente su resultado.

const LIGHT_GREEN = 360; // 6 s
const LIGHT_YELLOW = 90; // 1.5 s
const LIGHT_CYCLE = 2 * (LIGHT_GREEN + LIGHT_YELLOW);
const CROSSWALK_DEPTH = 16; // ancho de las franjas del paso de cebra
const ZEBRA_GAP = 14; // del borde del cruce al centro del paso de cebra
const STOP_GAP = 30; // la línea de detención queda antes del paso de cebra
const TRAFFIC_SPEED = 2; // ≈ 40 km/h, más lento que el máximo de los coches autónomos
const PED_SPEED = 0.8; // ≈ 4.5 km/h
const PED_PERIOD = 720; // en pasos sin semáforo cruza alguien cada 12 s
const PED_RADIUS = 9;
const NO_TRAFFIC = { cars: [], people: [], all: [] };

// Generador pseudoaleatorio con semilla (mulberry32).
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ¿Se puede circular por este tramo saliendo de `node`? (los de sentido único, solo desde a).
const canLeave = (segment, node) => !roadType(segment).oneway || segment.a === node;
const canArrive = (segment, node) => !roadType(segment).oneway || segment.b === node;

// Cada cruce (punto con 3 o más tramos) tiene un acceso por cada tramo por el que
// se puede llegar: su línea de detención, la dirección de entrada y la fase del
// ciclo en que tiene verde. Los accesos se ordenan por ángulo y se alternan, así
// los opuestos comparten fase. En las glorietas no hay semáforos: se cede el paso.
function buildIntersections(world) {
  const { graph } = world;
  const intersections = [];
  graph.points.forEach((node, index) => {
    const incident = graph.segments.filter((s) => s.a === node || s.b === node);
    if (incident.length < 3 || incident.some((s) => s.type === "glorieta")) return;
    const half = world.nodeHalf.get(node);
    const back = half + STOP_GAP;
    const approaches = incident
      .filter((s) => canArrive(s, node))
      .map((segment) => {
        const other = segment.a === node ? segment.b : segment.a;
        const len = distance(node, other);
        const u = { x: (node.x - other.x) / len, y: (node.y - other.y) / len }; // hacia el cruce
        return { segment, len, u, angle: Math.atan2(-u.y, -u.x) };
      })
      .filter((a) => a.len > back * 2 + 10)
      .sort((p, q) => p.angle - q.angle);
    if (approaches.length < 2) return;
    approaches.forEach((a, i) => {
      a.phase = i % 2;
      a.half = roadHalf(a.segment);
      a.right = { x: -a.u.y, y: a.u.x };
      a.stop = { x: node.x - a.u.x * back, y: node.y - a.u.y * back };
      a.zebra = { x: node.x - a.u.x * (half + ZEBRA_GAP), y: node.y - a.u.y * (half + ZEBRA_GAP) };
      // Barrera de un solo sentido: solo frena a quien entra al cruce.
      a.barrier = [
        { x: a.stop.x - a.right.x * a.half, y: a.stop.y - a.right.y * a.half },
        { x: a.stop.x + a.right.x * a.half, y: a.stop.y + a.right.y * a.half },
      ];
      a.barrier.kind = "light";
      a.barrier.normal = a.u;
      a.barrier.mid = a.stop;
      a.barrier.half = a.half;
      a.barrier.level = null;
    });
    intersections.push({ node, approaches, offset: (index * 137) % LIGHT_CYCLE, back });
  });
  return intersections;
}

function lightState(intersection, approach, frame) {
  const half = LIGHT_GREEN + LIGHT_YELLOW;
  const t = (frame + intersection.offset) % LIGHT_CYCLE;
  const active = t < half ? 0 : 1;
  if (approach.phase !== active) return "red";
  return t % half < LIGHT_GREEN ? "green" : "yellow";
}

// Pasos de cebra: uno en cada acceso con semáforo (se cruza mientras ese acceso
// está en rojo) y otro a media calle en los tramos largos a ras de suelo (cruza
// alguien cada 12 s). Cada uno sabe cuánto mide su calle de acera a acera.
function buildCrosswalks(world) {
  const crosswalks = [];
  const make = (c, u, half, extra) => {
    const path = half * 2 + 24;
    return { c, u, right: { x: -u.y, y: u.x }, half, path, walk: Math.round(path / PED_SPEED), ...extra };
  };
  for (const intersection of world.intersections) {
    for (const approach of intersection.approaches) {
      crosswalks.push(make(approach.zebra, approach.u, approach.half, { intersection, approach }));
    }
  }
  world.graph.segments.forEach((segment, i) => {
    const len = distance(segment.a, segment.b);
    if (len < 560 || segment.type === "puente" || segment.type === "glorieta") return;
    const u = { x: (segment.b.x - segment.a.x) / len, y: (segment.b.y - segment.a.y) / len };
    crosswalks.push(make(lerpPoint(segment.a, segment.b, 0.5), u, roadHalf(segment), { offset: (i * 211) % PED_PERIOD }));
  });
  return crosswalks;
}

// Dónde está el peatón de un paso de cebra en este fotograma (o null si no hay nadie).
function walkerAt(crosswalk, frame) {
  let t;
  let lap;
  if (crosswalk.intersection) {
    const half = LIGHT_GREEN + LIGHT_YELLOW;
    const local = frame + crosswalk.intersection.offset;
    const cycleT = local % LIGHT_CYCLE;
    const redSince = crosswalk.approach.phase === 0 ? cycleT - half : cycleT;
    if (redSince < 0 || redSince >= half) return null;
    t = redSince - 30; // espera medio segundo a que paren los coches
    lap = Math.floor(local / LIGHT_CYCLE);
  } else {
    const local = frame + crosswalk.offset;
    t = local % PED_PERIOD;
    lap = Math.floor(local / PED_PERIOD);
  }
  if (t < 0 || t >= crosswalk.walk) return null;
  const progress = t / crosswalk.walk;
  const along = lerp(-crosswalk.path / 2, crosswalk.path / 2, lap % 2 ? 1 - progress : progress);
  const dir = lap % 2 ? -1 : 1;
  return {
    x: crosswalk.c.x + crosswalk.right.x * along,
    y: crosswalk.c.y + crosswalk.right.y * along,
    angle: Math.atan2(crosswalk.right.y * dir, crosswalk.right.x * dir),
    crosswalk,
    tone: lap % 3,
  };
}

// Distancia del centro de la calzada al carril por el que circula un coche de
// tráfico (positiva = a la derecha según su sentido de marcha).
function laneOffset(segment, lane) {
  const type = segment.type || "normal";
  if (type === "avenida") return 20 + 40 * lane; // dos carriles por sentido
  if (type === "unico" || type === "glorieta") return lane ? -25 : 25; // los dos carriles van en el mismo sentido
  return 31; // por la derecha, dejando libre el centro de la calzada
}

// Coche de tráfico: recorre el grafo por su carril y respetando los sentidos únicos,
// frena ante el rojo, ante el coche de delante y ante peatones, y en cada cruce
// elige una salida permitida al azar (con la semilla).
class TrafficCar {
  constructor(traffic, segment, from, to, s, color, lane) {
    this.traffic = traffic;
    this.segment = segment;
    this.from = from;
    this.to = to;
    this.s = s; // distancia recorrida sobre el tramo actual
    this.lane = lane; // 0 o 1 en avenidas y sentido único
    this.speed = TRAFFIC_SPEED;
    this.color = color;
    this.place(true);
  }

  // En la parte central de un puente circula por arriba; en las rampas, a ras de suelo.
  get level() {
    const bridge = this.traffic.bridgeOf.get(this.segment);
    if (!bridge) return null;
    const margin = RAMP_LENGTH + ROAD_WIDTH / 2;
    return this.s > margin && this.s < bridge.len - margin ? bridge : null;
  }

  place(snap) {
    const len = distance(this.from, this.to) || 1;
    const u = { x: (this.to.x - this.from.x) / len, y: (this.to.y - this.from.y) / len };
    const offset = laneOffset(this.segment, this.lane);
    const tx = this.from.x + u.x * this.s - u.y * offset;
    const ty = this.from.y + u.y * this.s + u.x * offset;
    const ta = Math.atan2(u.y, u.x);
    if (snap) {
      this.x = tx;
      this.y = ty;
      this.angle = ta;
    } else {
      // Suaviza el salto de carril al cambiar de tramo.
      this.x = lerp(this.x, tx, 0.3);
      this.y = lerp(this.y, ty, 0.3);
      const turn = Math.atan2(Math.sin(ta - this.angle), Math.cos(ta - this.angle));
      this.angle += turn * 0.25;
    }
    this.polygon = carPolygon(this.x, this.y, this.angle);
  }

  update(traffic) {
    const len = distance(this.from, this.to);
    let target = TRAFFIC_SPEED;
    const light = traffic.lights ? traffic.approachAt(this.segment, this.to) : null;
    if (light) {
      const state = lightState(light.intersection, light.approach, traffic.frame);
      const gap = len - light.intersection.back - CAR_LENGTH / 2 - 4 - this.s;
      const mustStop = state === "red" || (state === "yellow" && gap > 20);
      if (mustStop && gap > -2 && gap < 70) target = gap < 3 ? 0 : Math.min(target, gap * 0.06);
    }
    for (const other of traffic.cars) {
      if (other === this || other.segment !== this.segment || other.to !== this.to || other.lane !== this.lane) continue;
      const gap = other.s - this.s;
      if (gap > 0 && gap < CAR_LENGTH * 1.5) target = 0;
      else if (gap > 0 && gap < CAR_LENGTH * 3) target = Math.min(target, other.speed);
    }
    // Cede el paso a quien cruza delante (los peatones están a ras de suelo).
    if (!this.level) {
      const hx = Math.cos(this.angle);
      const hy = Math.sin(this.angle);
      for (const w of traffic.walkers) {
        const dx = w.x - this.x;
        const dy = w.y - this.y;
        const ahead = dx * hx + dy * hy;
        const side = Math.abs(dx * hy - dy * hx);
        if (ahead > 0 && ahead < CAR_LENGTH * 2 && side < CAR_WIDTH + PED_RADIUS * 2) target = 0;
      }
    }
    this.speed += clamp(target - this.speed, -0.25, 0.06);
    this.s += this.speed;
    if (this.s >= len) this.advance(traffic, len);
    this.place(false);
  }

  advance(traffic, len) {
    const node = this.to;
    const touching = traffic.world.graph.segments.filter((s) => s.a === node || s.b === node);
    let exits = touching.filter((s) => s !== this.segment && canLeave(s, node));
    // Sin salida permitida: media vuelta si la calle es de doble sentido; si no,
    // cualquier salida (para no quedarse atascado en un mapa mal conectado).
    if (!exits.length) exits = canLeave(this.segment, node) ? [this.segment] : touching;
    const next = exits[Math.floor(traffic.rng() * exits.length)];
    this.s -= len;
    this.segment = next;
    this.from = node;
    this.to = next.a === node ? next.b : next.a;
  }
}

class Traffic {
  constructor(world, { count = 6, lights = true, pedestrians = true, seed = 20261028 } = {}) {
    this.world = world;
    this.count = count;
    this.lights = lights;
    this.pedestrians = pedestrians;
    this.rng = seededRandom(seed);
    this.frame = 0;
    this.bridgeOf = new Map(world.bridges.map((b) => [b.segment, b]));
    this.approaches = new Map(); // tramo -> accesos con semáforo en sus extremos
    for (const intersection of world.intersections) {
      for (const approach of intersection.approaches) {
        if (!this.approaches.has(approach.segment)) this.approaches.set(approach.segment, []);
        this.approaches.get(approach.segment).push({ node: intersection.node, intersection, approach });
      }
    }
    this.cars = [];
    this.walkers = [];
    this.segments = [];
    this.personSegments = [];
    this.barriers = [];
    this.out = { cars: [], people: [], all: [] };
    this.spawn();
    this.collect();
  }

  spawn() {
    const roads = this.world.graph.segments.filter((s) => distance(s.a, s.b) > ROAD_WIDTH + CAR_LENGTH);
    for (let tries = 0; this.cars.length < this.count && roads.length && tries < this.count * 25; tries++) {
      const segment = roads[Math.floor(this.rng() * roads.length)];
      const forward = roadType(segment).oneway || this.rng() < 0.5;
      const from = forward ? segment.a : segment.b;
      const to = forward ? segment.b : segment.a;
      const s = ROAD_WIDTH / 2 + this.rng() * (distance(from, to) - ROAD_WIDTH);
      const lane = this.rng() < 0.5 ? 0 : 1;
      const car = new TrafficCar(this, segment, from, to, s, this.cars.length % 4, lane);
      if (distance(car, this.world.start) < 240) continue; // la salida queda despejada
      if (this.cars.some((o) => distance(o, car) < CAR_LENGTH * 1.8)) continue;
      this.cars.push(car);
    }
  }

  approachAt(segment, node) {
    const list = this.approaches.get(segment);
    return list ? list.find((entry) => entry.node === node) || null : null;
  }

  update() {
    this.frame++;
    this.walkers.length = 0;
    if (this.pedestrians) {
      for (const crosswalk of this.world.crosswalks) {
        const walker = walkerAt(crosswalk, this.frame);
        if (walker) this.walkers.push(walker);
      }
    }
    for (const car of this.cars) car.update(this);
    this.collect();
  }

  // Obstáculos móviles de este fotograma: carrocerías (con su nivel), peatones (y el
  // paso de cebra que ocupan, para que los sensores lo vean) y semáforos en rojo.
  collect() {
    this.segments.length = 0;
    for (const car of this.cars) {
      const p = car.polygon;
      const level = car.level;
      for (let i = 0; i < p.length; i++) {
        const seg = [p[i], p[(i + 1) % p.length]];
        seg.kind = "car";
        seg.mid = car;
        seg.level = level;
        this.segments.push(seg);
      }
    }
    this.personSegments.length = 0;
    for (const w of this.walkers) {
      const r = PED_RADIUS;
      const body = [
        { x: w.x - r, y: w.y - r },
        { x: w.x + r, y: w.y - r },
        { x: w.x + r, y: w.y + r },
        { x: w.x - r, y: w.y + r },
      ];
      for (let i = 0; i < 4; i++) {
        const seg = [body[i], body[(i + 1) % 4]];
        seg.kind = "person";
        seg.mid = w;
        this.personSegments.push(seg);
      }
      // Bordes del paso ocupado: solo los ven los sensores, no matan.
      const { c, u, right, half } = w.crosswalk;
      for (const side of [-1, 1]) {
        const m = { x: c.x + u.x * (CROSSWALK_DEPTH / 2) * side, y: c.y + u.y * (CROSSWALK_DEPTH / 2) * side };
        const seg = [
          { x: m.x - right.x * half, y: m.y - right.y * half },
          { x: m.x + right.x * half, y: m.y + right.y * half },
        ];
        seg.kind = "person";
        seg.mid = m;
        seg.sensorOnly = true;
        this.personSegments.push(seg);
      }
    }
    this.barriers.length = 0;
    if (!this.lights) return;
    for (const intersection of this.world.intersections) {
      for (const approach of intersection.approaches) {
        if (lightState(intersection, approach, this.frame) === "red") this.barriers.push(approach.barrier);
      }
    }
  }

  // Obstáculos móviles cerca de (x, y) en el mismo nivel (suelo o un puente).
  near(x, y, reach, level = null) {
    const { cars, people, all } = this.out;
    cars.length = 0;
    people.length = 0;
    all.length = 0;
    const r = reach + CAR_LENGTH;
    for (const seg of this.segments) {
      if (seg.level !== level) continue;
      if (Math.abs(seg.mid.x - x) < r && Math.abs(seg.mid.y - y) < r) {
        cars.push(seg);
        all.push(seg);
      }
    }
    if (level) return this.out; // en el puente no hay peatones ni semáforos
    const rp = reach + ROAD_WIDTH;
    for (const seg of this.personSegments) {
      if (Math.abs(seg.mid.x - x) < rp && Math.abs(seg.mid.y - y) < rp) {
        if (!seg.sensorOnly) people.push(seg);
        all.push(seg);
      }
    }
    for (const b of this.barriers) {
      if (Math.abs(b.mid.x - x) < rp && Math.abs(b.mid.y - y) < rp) all.push(b);
    }
    return this.out;
  }

  // ¿El centro del coche cruzó una línea de detención en rojo hacia el cruce?
  ranRed(x0, y0, x1, y1) {
    for (const b of this.barriers) {
      const n = b.normal;
      const m = b.mid;
      const before = (x0 - m.x) * n.x + (y0 - m.y) * n.y;
      const after = (x1 - m.x) * n.x + (y1 - m.y) * n.y;
      if (before < 0 && after >= 0) {
        const lateral = Math.abs(-(x1 - m.x) * n.y + (y1 - m.y) * n.x);
        if (lateral <= b.half) return true;
      }
    }
    return false;
  }
}
