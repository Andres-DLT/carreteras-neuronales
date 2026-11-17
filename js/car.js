"use strict";
// Coche autónomo: física sencilla, sensores de distancia y un cerebro.

const CAR_LENGTH = 48;
const CAR_WIDTH = 26;
const METERS_PER_UNIT = 4.5 / CAR_LENGTH; // un coche compacto mide unos 4.5 m
const CELL_SIZE = 40; // rejilla con la que se mide el terreno explorado (3.75 m)
const IDLE_LIMIT = 150; // fotogramas sin pisar terreno nuevo antes de retirarlo (2.5 s)
const BRAIN_INPUTS = 9; // 7 sensores + semáforo delante + coche o peatón delante
const GOAL_INPUTS = BRAIN_INPUTS + 2; // modo destino: además, hacia dónde sigue la ruta
const GOAL_LOOK = 110; // la guía apunta a un punto de la ruta esta distancia por delante (≈ 10 m)

// Abanico de rayos hacia delante; cada lectura es la distancia al borde más cercano.
class Sensor {
  constructor(car, rayCount = 7, rayLength = 200, raySpread = Math.PI * 0.75) {
    this.car = car;
    this.rayCount = rayCount;
    this.rayLength = rayLength;
    this.raySpread = raySpread;
    this.rays = [];
    this.readings = [];
  }

  // segments: bordes fijos; moving: coches de tráfico y semáforos en rojo.
  // Un semáforo solo se ve desde el lado por el que se entra al cruce.
  update(segments, moving = []) {
    const { car } = this;
    for (let i = 0; i < this.rayCount; i++) {
      const t = this.rayCount === 1 ? 0.5 : i / (this.rayCount - 1);
      const angle = car.angle + lerp(-this.raySpread / 2, this.raySpread / 2, t);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const start = { x: car.x, y: car.y };
      const end = { x: car.x + dx * this.rayLength, y: car.y + dy * this.rayLength };
      let nearest = null;
      for (const [p, q] of segments) {
        const hit = getIntersection(start, end, p, q);
        if (hit && (!nearest || hit.offset < nearest.offset)) {
          hit.kind = "edge";
          nearest = hit;
        }
      }
      for (const seg of moving) {
        if (seg.normal && dx * seg.normal.x + dy * seg.normal.y <= 0) continue;
        const hit = getIntersection(start, end, seg[0], seg[1]);
        if (hit && (!nearest || hit.offset < nearest.offset)) {
          hit.kind = seg.kind;
          nearest = hit;
        }
      }
      this.rays[i] = [start, end];
      this.readings[i] = nearest;
    }
  }
}

// La carrocería de un coche como cuatro segmentos que los sensores ven como "car".
function carOutline(car) {
  const p = car.polygon;
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const seg = [p[i], p[(i + 1) % p.length]];
    seg.kind = "car";
    out.push(seg);
  }
  return out;
}

function carPolygon(x, y, angle) {
  const radius = Math.hypot(CAR_LENGTH, CAR_WIDTH) / 2;
  const alpha = Math.atan2(CAR_WIDTH, CAR_LENGTH);
  return [alpha, -alpha, Math.PI + alpha, Math.PI - alpha].map((a) => ({
    x: x + Math.cos(angle + a) * radius,
    y: y + Math.sin(angle + a) * radius,
  }));
}

class Car {
  constructor(x, y, angle, brain = null) {
    this.x = x;
    this.y = y;
    this.angle = angle; // 0 apunta a la derecha; crece en sentido horario en pantalla
    this.speed = 0;
    this.acceleration = 0.2;
    this.maxSpeed = 3.2;
    this.friction = 0.05;
    this.turnRate = 0.035;
    this.damaged = false;
    this.reason = null;
    this.sensor = new Sensor(this);
    this.brain = brain || new NeuralNetwork([BRAIN_INPUTS, 6, 4]);
    this.controls = { forward: false, reverse: false, steer: 0 }; // steer: -1 izquierda … 1 derecha
    this.cells = new Set();
    this.idle = 0;
    this.level = null; // null = a ras de suelo; si no, el puente por el que va
    this.manual = null; // mandos { forward, reverse, steer } si lo conduce una persona
    this.age = 0; // pasos que lleva en marcha
    // Modo convivir: los coches de su equipo (él incluido), con los que puede chocar, y
    // su propia carrocería como segmentos, para que la vean los sensores de los demás.
    this.mates = null;
    this.outline = null;
    // Modo destino: la ruta que sigue, el tramo en el que va, lo recorrido y si ya llegó.
    this.route = null;
    this.leg = 1;
    this.progress = 0;
    this.arrived = false;
    this.arrivedAt = 0;
    this.polygon = this.createPolygon();
    this.explore();
  }

  get distance() {
    return this.cells.size * CELL_SIZE * METERS_PER_UNIT;
  }

  get kmh() {
    return Math.abs(this.speed) * 60 * METERS_PER_UNIT * 3.6;
  }

  update(world, scratch, traffic = null) {
    if (this.damaged || this.arrived) return;
    this.age++;
    const x0 = this.x;
    const y0 = this.y;
    this.move();
    this.updateLevel(world);
    this.polygon = this.createPolygon();
    if (this.mates) this.outline = carOutline(this);
    const reach = this.sensor.rayLength + CAR_LENGTH;
    // Sobre un puente solo cuentan sus barandillas; abajo, los bordes de las calles.
    const nearby = this.level
      ? this.level.sides
      : world.grid.query(this.x - reach, this.y - reach, this.x + reach, this.y + reach, scratch);
    const moving = traffic ? traffic.near(this.x, this.y, reach, this.level) : NO_TRAFFIC;
    if (this.collides(nearby) || this.collides(moving.cars)) {
      this.crash("choque");
      return;
    }
    if (this.collides(moving.people)) {
      this.crash("atropello");
      return;
    }
    if (traffic && !this.level && traffic.ranRed(x0, y0, this.x, this.y)) {
      this.crash("semáforo");
      return;
    }
    // Con compañeros de equipo en la calle: chocar con uno elimina a los dos, y los
    // sensores los ven igual que al tráfico.
    const seen = this.mates ? this.meetMates(moving.all, reach) : moving.all;
    if (this.damaged) return;
    this.sensor.update(nearby, seen);
    // 7 distancias + qué tan cerca hay un rojo + qué tan cerca hay un coche o un
    // peatón: sin estas dos, un semáforo se ve igual que la pared de una curva.
    const inputs = this.sensor.readings.map((r) => (r ? 1 - r.offset : 0));
    let light = 0;
    let car = 0;
    for (const r of this.sensor.readings) {
      if (r && r.kind === "light") light = Math.max(light, 1 - r.offset);
      if (r && (r.kind === "car" || r.kind === "person")) car = Math.max(car, 1 - r.offset);
    }
    inputs.push(light, car);
    if (this.route) {
      inputs.push(...this.follow());
      if (this.arrived) return;
    }
    if (this.manual) {
      // Lo conduce una persona: los mandos vienen del teclado o de la pantalla, y nadie
      // lo retira por quedarse parado.
      Object.assign(this.controls, this.manual);
      this.explore(true);
      return;
    }
    const [forward, left, right, reverse] = NeuralNetwork.feedForward(inputs, this.brain);
    // Si se activan a la vez la neurona de izquierda y la de derecha, se anulan.
    const steer = right - left;
    Object.assign(this.controls, { forward: forward > 0.5, reverse: reverse > 0.5, steer });
    // Esperar ante un rojo o detrás de otro coche no cuenta como estar atascado.
    this.explore(light > 0 || car > 0.4);
    if (this.idle > IDLE_LIMIT) this.crash("atascado");
  }

  // Añade a lo que ven los sensores las carrocerías de los compañeros cercanos, y
  // comprueba si choca con alguno.
  meetMates(all, reach) {
    const out = this.seen || (this.seen = []);
    out.length = 0;
    for (const seg of all) out.push(seg);
    for (const mate of this.mates) {
      if (mate === this || mate.damaged || mate.arrived || !mate.outline || mate.level !== this.level) continue;
      if (Math.abs(mate.x - this.x) > reach || Math.abs(mate.y - this.y) > reach) continue;
      if (this.collides(mate.outline)) {
        this.crash("choque");
        mate.crash("choque");
        return out;
      }
      for (const seg of mate.outline) out.push(seg);
    }
    return out;
  }

  // Modo destino: anota lo que lleva recorrido de la ruta y devuelve hacia dónde sigue,
  // como dos entradas para la red: cuánto a la derecha (seno) y cuánto por delante
  // (coseno) queda un punto de la ruta situado algo más adelante.
  follow() {
    const { points, cum, length } = this.route;
    const last = points.length - 1;
    // Dónde va el coche sobre la ruta: en su tramo o en uno de los dos siguientes.
    let best = null;
    for (let i = this.leg; i <= Math.min(last, this.leg + 2); i++) {
      const proj = projectOnSegment(this, points[i - 1], points[i]);
      const cost = proj.dist + (i - this.leg) * 15; // en caso de duda, el tramo en el que ya iba
      if (!best || cost < best.cost) best = { i, cost, t: proj.t, dist: proj.dist };
    }
    if (best.dist < 160) {
      // Solo avanza mientras no se salga de la ruta.
      this.leg = best.i;
      this.progress = Math.max(this.progress, cum[best.i - 1] + best.t * (cum[best.i] - cum[best.i - 1]));
    }
    const end = points[last];
    if (this.progress > length - 70 && Math.hypot(end.x - this.x, end.y - this.y) < end.r) {
      this.arrived = true;
      this.arrivedAt = this.age;
      this.progress = length;
      this.speed = 0;
    }
    // Punto de mira: un poco más adelante por la ruta, así dobla las esquinas con tiempo.
    const s = Math.min(length, this.progress + GOAL_LOOK);
    let i = this.leg;
    while (i < last && cum[i] < s) i++;
    const k = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const aimX = points[i - 1].x + (points[i].x - points[i - 1].x) * k;
    const aimY = points[i - 1].y + (points[i].y - points[i - 1].y) * k;
    const turn = Math.atan2(aimY - this.y, aimX - this.x) - this.angle;
    return [Math.sin(turn), Math.cos(turn)];
  }

  // Sube a un puente al entrar por uno de sus extremos en la dirección del puente,
  // y baja al salir de su tablero. Pasar por debajo no cambia de nivel.
  updateLevel(world) {
    if (this.level) {
      if (!pointInPolygon(this, this.level.envelope)) this.level = null;
      return;
    }
    for (const bridge of world.bridges) {
      if (!pointInPolygon(this, bridge.envelope)) continue;
      const { a } = bridge.segment;
      const along = (this.x - a.x) * bridge.u.x + (this.y - a.y) * bridge.u.y;
      const fromEnd = Math.min(along, bridge.len - along);
      const aligned = Math.abs(Math.cos(this.angle) * bridge.u.x + Math.sin(this.angle) * bridge.u.y) > 0.7;
      if (aligned && fromEnd > 15 && fromEnd < RAMP_LENGTH + 40) {
        this.level = bridge;
        return;
      }
    }
  }

  move() {
    const c = this.controls;
    if (c.forward) this.speed += this.acceleration;
    if (c.reverse) this.speed -= this.acceleration;
    this.speed = clamp(this.speed, -this.maxSpeed / 2, this.maxSpeed);
    if (this.speed > 0) this.speed -= this.friction;
    if (this.speed < 0) this.speed += this.friction;
    if (Math.abs(this.speed) < this.friction) this.speed = 0;
    if (this.speed !== 0 && c.steer) {
      const flip = this.speed > 0 ? 1 : -1;
      this.angle += this.turnRate * c.steer * flip;
    }
    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;
  }

  createPolygon() {
    return carPolygon(this.x, this.y, this.angle);
  }

  collides(segments) {
    const poly = this.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      for (const [p, q] of segments) if (getIntersection(a, b, p, q)) return true;
    }
    return false;
  }

  // La aptitud es el terreno distinto que pisa: dar vueltas en el mismo sitio no suma.
  explore(waiting = false) {
    const key = Math.floor(this.x / CELL_SIZE) * 100003 + Math.floor(this.y / CELL_SIZE);
    if (this.cells.has(key)) {
      if (!waiting) this.idle++;
    } else {
      this.cells.add(key);
      this.idle = 0;
    }
  }

  crash(reason) {
    this.damaged = true;
    this.reason = reason;
    this.speed = 0;
  }
}
