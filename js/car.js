"use strict";
// Coche autónomo: física sencilla, sensores de distancia y un cerebro.

const CAR_LENGTH = 48;
const CAR_WIDTH = 26;
const METERS_PER_UNIT = 4.5 / CAR_LENGTH; // un coche compacto mide unos 4.5 m
const CELL_SIZE = 40; // rejilla con la que se mide el terreno explorado (3.75 m)
const IDLE_LIMIT = 150; // fotogramas sin pisar terreno nuevo antes de retirarlo (2.5 s)

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

  update(segments) {
    const { car } = this;
    for (let i = 0; i < this.rayCount; i++) {
      const t = this.rayCount === 1 ? 0.5 : i / (this.rayCount - 1);
      const angle = car.angle + lerp(-this.raySpread / 2, this.raySpread / 2, t);
      const start = { x: car.x, y: car.y };
      const end = {
        x: car.x + Math.cos(angle) * this.rayLength,
        y: car.y + Math.sin(angle) * this.rayLength,
      };
      let nearest = null;
      for (const [p, q] of segments) {
        const hit = getIntersection(start, end, p, q);
        if (hit && (!nearest || hit.offset < nearest.offset)) nearest = hit;
      }
      this.rays[i] = [start, end];
      this.readings[i] = nearest;
    }
  }
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
    this.brain = brain || new NeuralNetwork([this.sensor.rayCount, 6, 4]);
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

  update(grid, scratch) {
    if (this.damaged) return;
    this.move();
    this.polygon = this.createPolygon();
    const reach = this.sensor.rayLength + CAR_LENGTH;
    const nearby = grid.query(this.x - reach, this.y - reach, this.x + reach, this.y + reach, scratch);
    if (this.collides(nearby)) {
      this.crash("choque");
      return;
    }
    this.sensor.update(nearby);
    const inputs = this.sensor.readings.map((r) => (r ? 1 - r.offset : 0));
    const [forward, left, right, reverse] = NeuralNetwork.feedForward(inputs, this.brain);
    Object.assign(this.controls, { forward: !!forward, left: !!left, right: !!right, reverse: !!reverse });
    this.explore();
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
    const radius = Math.hypot(CAR_LENGTH, CAR_WIDTH) / 2;
    const alpha = Math.atan2(CAR_WIDTH, CAR_LENGTH);
    return [alpha, -alpha, Math.PI + alpha, Math.PI - alpha].map((a) => ({
      x: this.x + Math.cos(this.angle + a) * radius,
      y: this.y + Math.sin(this.angle + a) * radius,
    }));
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
  explore() {
    const key = Math.floor(this.x / CELL_SIZE) * 100003 + Math.floor(this.y / CELL_SIZE);
    if (this.cells.has(key)) {
      this.idle++;
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
