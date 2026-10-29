"use strict";
// Coche autónomo: física sencilla, sensores de distancia y un cerebro.

const CAR_LENGTH = 48;
const CAR_WIDTH = 26;
const METERS_PER_UNIT = 4.5 / CAR_LENGTH; // un coche compacto mide unos 4.5 m
const CELL_SIZE = 40; // rejilla con la que se mide el terreno explorado (3.75 m)
const IDLE_LIMIT = 150; // fotogramas sin pisar terreno nuevo antes de retirarlo (2.5 s)
const BRAIN_INPUTS = 9; // 7 sensores + semáforo delante + coche o peatón delante

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
    this.controls = { forward: false, left: false, right: false, reverse: false };
    this.cells = new Set();
    this.idle = 0;
    this.polygon = this.createPolygon();
    this.explore();
  }

  get distance() {
    return this.cells.size * CELL_SIZE * METERS_PER_UNIT;
  }

  get kmh() {
    return Math.abs(this.speed) * 60 * METERS_PER_UNIT * 3.6;
  }

  update(grid, scratch, traffic = null) {
    if (this.damaged) return;
    const x0 = this.x;
    const y0 = this.y;
    this.move();
    this.polygon = this.createPolygon();
    const reach = this.sensor.rayLength + CAR_LENGTH;
    const nearby = grid.query(this.x - reach, this.y - reach, this.x + reach, this.y + reach, scratch);
    const moving = traffic ? traffic.near(this.x, this.y, reach) : NO_TRAFFIC;
    if (this.collides(nearby) || this.collides(moving.cars)) {
      this.crash("choque");
      return;
    }
    if (this.collides(moving.people)) {
      this.crash("atropello");
      return;
    }
    if (traffic && traffic.ranRed(x0, y0, this.x, this.y)) {
      this.crash("semáforo");
      return;
    }
    this.sensor.update(nearby, moving.all);
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
    const [forward, left, right, reverse] = NeuralNetwork.feedForward(inputs, this.brain);
    Object.assign(this.controls, { forward: !!forward, left: !!left, right: !!right, reverse: !!reverse });
    // Esperar ante un rojo o detrás de otro coche no cuenta como estar atascado.
    this.explore(light > 0 || car > 0.4);
    if (this.idle > IDLE_LIMIT) this.crash("atascado");
  }

  move() {
    const c = this.controls;
    if (c.forward) this.speed += this.acceleration;
    if (c.reverse) this.speed -= this.acceleration;
    this.speed = clamp(this.speed, -this.maxSpeed / 2, this.maxSpeed);
    if (this.speed > 0) this.speed -= this.friction;
    if (this.speed < 0) this.speed += this.friction;
    if (Math.abs(this.speed) < this.friction) this.speed = 0;
    if (this.speed !== 0) {
      const flip = this.speed > 0 ? 1 : -1;
      if (c.left) this.angle -= this.turnRate * flip;
      if (c.right) this.angle += this.turnRate * flip;
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
