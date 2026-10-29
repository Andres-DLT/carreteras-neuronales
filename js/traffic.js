"use strict";
// Tráfico y semáforos. Todo es determinista dentro de una generación (misma
// semilla y mismos tiempos), así el mejor cerebro repite exactamente su resultado.

const LIGHT_GREEN = 360; // 6 s
const LIGHT_YELLOW = 90; // 1.5 s
const LIGHT_CYCLE = 2 * (LIGHT_GREEN + LIGHT_YELLOW);
const STOP_GAP = 10; // distancia entre la línea de detención y el borde del cruce
const LANE_OFFSET = 31; // por la derecha, dejando libre el centro de la calzada
const TRAFFIC_SPEED = 2; // ≈ 40 km/h, más lento que el máximo de los coches autónomos
const NO_TRAFFIC = { cars: [], all: [] };

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

// Cada cruce (punto con 3 o más tramos) tiene un acceso por tramo: su línea de
// detención, la dirección de entrada y la fase del ciclo en que tiene verde.
// Los accesos se ordenan por ángulo y se alternan, así los opuestos comparten fase.
function buildIntersections(graph) {
  const intersections = [];
  graph.points.forEach((node, index) => {
    const approaches = graph.segments
      .filter((s) => s.a === node || s.b === node)
      .map((segment) => {
        const other = segment.a === node ? segment.b : segment.a;
        const len = distance(node, other);
        const u = { x: (node.x - other.x) / len, y: (node.y - other.y) / len }; // hacia el cruce
        return { segment, len, u, angle: Math.atan2(-u.y, -u.x) };
      })
      .filter((a) => a.len > ROAD_WIDTH + STOP_GAP * 2 + 10)
      .sort((p, q) => p.angle - q.angle);
    if (approaches.length < 3) return;
    const back = ROAD_WIDTH / 2 + STOP_GAP;
    approaches.forEach((a, i) => {
      a.phase = i % 2;
      a.right = { x: -a.u.y, y: a.u.x };
      a.stop = { x: node.x - a.u.x * back, y: node.y - a.u.y * back };
      const half = ROAD_WIDTH / 2;
      // Barrera de un solo sentido: solo frena a quien entra al cruce.
      a.barrier = [
        { x: a.stop.x - a.right.x * half, y: a.stop.y - a.right.y * half },
        { x: a.stop.x + a.right.x * half, y: a.stop.y + a.right.y * half },
      ];
      a.barrier.kind = "light";
      a.barrier.normal = a.u;
      a.barrier.mid = a.stop;
    });
    intersections.push({ node, approaches, offset: (index * 137) % LIGHT_CYCLE });
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

// Coche de tráfico: recorre el grafo por su carril, frena ante el rojo y ante el
// coche de delante, y en cada cruce elige una salida al azar (con la semilla).
class TrafficCar {
  constructor(segment, from, to, s, color) {
    this.segment = segment;
    this.from = from;
    this.to = to;
    this.s = s; // distancia recorrida sobre el tramo actual
    this.speed = TRAFFIC_SPEED;
    this.color = color;
    this.place(true);
  }

  place(snap) {
    const len = distance(this.from, this.to) || 1;
    const u = { x: (this.to.x - this.from.x) / len, y: (this.to.y - this.from.y) / len };
    const tx = this.from.x + u.x * this.s - u.y * LANE_OFFSET;
    const ty = this.from.y + u.y * this.s + u.x * LANE_OFFSET;
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
      const gap = len - (ROAD_WIDTH / 2 + STOP_GAP) - CAR_LENGTH / 2 - 4 - this.s;
      const mustStop = state === "red" || (state === "yellow" && gap > 20);
      if (mustStop && gap > -2 && gap < 70) target = gap < 3 ? 0 : Math.min(target, gap * 0.06);
    }
    for (const other of traffic.cars) {
      if (other === this || other.segment !== this.segment || other.to !== this.to) continue;
      const gap = other.s - this.s;
      if (gap > 0 && gap < CAR_LENGTH * 1.5) target = 0;
      else if (gap > 0 && gap < CAR_LENGTH * 3) target = Math.min(target, other.speed);
    }
    this.speed += clamp(target - this.speed, -0.25, 0.06);
    this.s += this.speed;
    if (this.s >= len) this.advance(traffic, len);
    this.place(false);
  }

  advance(traffic, len) {
    const node = this.to;
    const exits = traffic.world.graph.segments.filter((s) => s !== this.segment && (s.a === node || s.b === node));
    const next = exits.length ? exits[Math.floor(traffic.rng() * exits.length)] : this.segment; // sin salida: media vuelta
    this.s -= len;
    this.segment = next;
    this.from = node;
    this.to = next.a === node ? next.b : next.a;
  }
}

class Traffic {
  constructor(world, { count = 6, lights = true, seed = 20261028 } = {}) {
    this.world = world;
    this.count = count;
    this.lights = lights;
    this.rng = seededRandom(seed);
    this.frame = 0;
    this.approaches = new Map(); // tramo -> accesos con semáforo en sus extremos
    for (const intersection of world.intersections) {
      for (const approach of intersection.approaches) {
        if (!this.approaches.has(approach.segment)) this.approaches.set(approach.segment, []);
        this.approaches.get(approach.segment).push({ node: intersection.node, intersection, approach });
      }
    }
    this.cars = [];
    this.segments = [];
    this.barriers = [];
    this.out = { cars: [], all: [] };
    this.spawn();
    this.collect();
  }

  spawn() {
    const roads = this.world.graph.segments.filter((s) => distance(s.a, s.b) > ROAD_WIDTH + CAR_LENGTH);
    for (let tries = 0; this.cars.length < this.count && roads.length && tries < this.count * 25; tries++) {
      const segment = roads[Math.floor(this.rng() * roads.length)];
      const forward = this.rng() < 0.5;
      const from = forward ? segment.a : segment.b;
      const to = forward ? segment.b : segment.a;
      const s = ROAD_WIDTH / 2 + this.rng() * (distance(from, to) - ROAD_WIDTH);
      const car = new TrafficCar(segment, from, to, s, this.cars.length % 4);
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
    for (const car of this.cars) car.update(this);
    this.collect();
  }

  // Obstáculos móviles de este fotograma: carrocerías y semáforos en rojo.
  collect() {
    this.segments.length = 0;
    for (const car of this.cars) {
      const p = car.polygon;
      for (let i = 0; i < p.length; i++) {
        const seg = [p[i], p[(i + 1) % p.length]];
        seg.kind = "car";
        seg.mid = car;
        this.segments.push(seg);
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

  near(x, y, reach) {
    const { cars, all } = this.out;
    cars.length = 0;
    all.length = 0;
    const r = reach + CAR_LENGTH;
    for (const seg of this.segments) {
      if (Math.abs(seg.mid.x - x) < r && Math.abs(seg.mid.y - y) < r) {
        cars.push(seg);
        all.push(seg);
      }
    }
    const rb = reach + ROAD_WIDTH;
    for (const b of this.barriers) {
      if (Math.abs(b.mid.x - x) < rb && Math.abs(b.mid.y - y) < rb) all.push(b);
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
        if (lateral <= ROAD_WIDTH / 2) return true;
      }
    }
    return false;
  }
}
