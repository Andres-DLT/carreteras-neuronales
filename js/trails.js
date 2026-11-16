"use strict";
// Estelas de luz: una "foto de larga exposición" del entrenamiento. Cada coche deja
// un trazo tenue que se suma a los de los demás, así la calle por la que pasa mucha
// población brilla más (de azul a cian y a blanco). Donde un coche queda eliminado se
// enciende una chispa, y al empezar otra generación lo anterior se atenúa y queda de
// fondo, con lo que se ve cómo cambia el recorrido de una generación a otra.
//
// La luz se acumula en un lienzo aparte en coordenadas del mundo: en cada paso solo
// se pintan los tramos nuevos, y en cada fotograma el lienzo entero se copia de una vez.

const TRAIL_STEP = 10; // unidades que avanza un coche entre dos muestras de su estela (≈ 1 m)
const TRAIL_WIDTH = 5; // grosor del trazo, en unidades del mundo
const TRAIL_ALPHA = 0.09; // luz que aporta cada coche: con unos 50 encima llega a blanco
const TRAIL_KEEP = 0.45; // parte de la luz que sobrevive al empezar otra generación
const TRAIL_MARGIN = 150; // borde alrededor del mapa, para que quepa media avenida
const SPARK_RADIUS = 8; // radio del destello donde un coche queda eliminado
const TRAIL_TILE = 256; // lado de las baldosas con que se anota qué zonas del lienzo cambian

class Trails {
  // maxSize: lado máximo del lienzo, en píxeles (acota la memoria en mapas grandes).
  constructor(maxSize = 2048) {
    this.maxSize = maxSize;
    this.reset();
  }

  // Olvida todo: el mapa cambió o las estelas se apagaron.
  reset() {
    this.world = null;
    this.box = null;
    this.layers = [null, null]; // 0: a ras de suelo; 1: sobre los puentes
    this.cars = null;
    this.paths = [];
    this.done = null;
    // La vista 3D usa el lienzo del suelo como textura y solo vuelve a subir a la
    // tarjeta gráfica lo que cambió: las baldosas anotadas aquí, o todo si dirtyAll.
    this.dirty = new Set();
    this.dirtyAll = true;
  }

  // Anota las baldosas del lienzo del suelo que toca el rectángulo (en unidades del mapa).
  mark(x0, y0, x1, y1, pad) {
    if (this.dirtyAll) return;
    const { x, y, scale } = this.box;
    const tile = (v, origin) => Math.max(0, Math.floor(((v - origin) * scale) / TRAIL_TILE));
    const bx = tile(Math.max(x0, x1) + pad, x);
    const by = tile(Math.max(y0, y1) + pad, y);
    for (let ty = tile(Math.min(y0, y1) - pad, y); ty <= by; ty++) {
      for (let tx = tile(Math.min(x0, x1) - pad, x); tx <= bx; tx++) this.dirty.add(ty * 4096 + tx);
    }
    if (this.dirty.size > 2000) this.touchAll(); // nadie las está recogiendo (vista en plano)
  }

  touchAll() {
    this.dirty.clear();
    this.dirtyAll = true;
  }

  // Prepara los lienzos para un mapa: uno para el suelo y, si hay puentes, otro para
  // lo que circula por encima (se pinta después del tablero).
  attach(world) {
    this.world = world;
    this.box = null;
    this.layers = [null, null];
    const points = world.graph.points;
    if (!points.length) return;
    const b = boundsOf(points);
    const box = {
      x: b.minX - TRAIL_MARGIN,
      y: b.minY - TRAIL_MARGIN,
      w: b.maxX - b.minX + TRAIL_MARGIN * 2,
      h: b.maxY - b.minY + TRAIL_MARGIN * 2,
    };
    box.scale = Math.min(1, this.maxSize / Math.max(box.w, box.h));
    this.box = box;
    this.layers = [this.makeLayer(), world.bridges.length ? this.makeLayer() : null];
    this.touchAll();
  }

  makeLayer() {
    const { x, y, w, h, scale } = this.box;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(w * scale));
    canvas.height = Math.max(1, Math.ceil(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    ctx.globalCompositeOperation = "lighter"; // la luz se suma
    ctx.lineCap = "butt"; // con extremos redondos cada unión de dos tramos brillaría el doble
    ctx.lineWidth = Math.max(TRAIL_WIDTH, 1.4 / scale);
    return ctx;
  }

  layerFor(level) {
    return this.layers[level] || this.layers[0];
  }

  // Empieza una manga: lo dibujado hasta ahora se atenúa y cada coche estrena estela.
  begin(cars) {
    for (const ctx of this.layers) {
      if (!ctx) continue;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1 - TRAIL_KEEP;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
    this.touchAll();
    this.cars = cars;
    this.paths = cars.map((car) => [car.x, car.y, car.level ? 1 : 0]);
    this.done = new Uint8Array(cars.length);
  }

  // Tras cada paso de la simulación: alarga la estela de los coches que avanzaron lo
  // suficiente y cierra la de los que acaban de quedar eliminados.
  track(sim, colors) {
    if (this.cars && this.cars !== sim.cars) this.advance(colors, true); // remata la manga anterior
    if (this.world !== sim.world) this.attach(sim.world);
    if (this.cars !== sim.cars) this.begin(sim.cars);
    this.advance(colors, false);
  }

  advance(colors, closing) {
    if (!this.box) return;
    const { cars, paths, done } = this;
    for (let i = 0; i < cars.length; i++) {
      if (done[i]) continue;
      const car = cars[i];
      const path = paths[i];
      const x0 = path[path.length - 3];
      const y0 = path[path.length - 2];
      const moved = Math.hypot(car.x - x0, car.y - y0);
      const ended = car.damaged || closing;
      if (moved < (ended ? 0.5 : TRAIL_STEP)) {
        if (ended) this.finish(i, car, colors);
        continue;
      }
      const level = car.level ? 1 : 0;
      const ctx = this.layerFor(level);
      ctx.globalAlpha = TRAIL_ALPHA;
      ctx.strokeStyle = colors.trail;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(car.x, car.y);
      ctx.stroke();
      if (ctx === this.layers[0]) this.mark(x0, y0, car.x, car.y, ctx.lineWidth);
      path.push(car.x, car.y, level);
      if (ended) this.finish(i, car, colors);
    }
  }

  // Fin de una estela; si el coche quedó eliminado, deja un destello en ese punto.
  finish(i, car, colors) {
    this.done[i] = 1;
    if (!car.damaged) return;
    const ctx = this.layerFor(car.level ? 1 : 0);
    const r = Math.max(SPARK_RADIUS, 3 / this.box.scale);
    const glow = ctx.createRadialGradient(car.x, car.y, 0, car.x, car.y, r);
    glow.addColorStop(0, colors.spark);
    glow.addColorStop(0.35, colors.spark);
    glow.addColorStop(1, "rgb(0 0 0 / 0)");
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(car.x, car.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (ctx === this.layers[0]) this.mark(car.x, car.y, car.x, car.y, r);
  }

  // Pinta en el lienzo del juego (ya en coordenadas del mundo) la luz acumulada de un
  // nivel y, encima, el recorrido completo del líder.
  draw(ctx, onBridge, leader, colors) {
    if (!this.box) return;
    const level = onBridge ? 1 : 0;
    const layer = this.layers[level];
    ctx.save();
    if (layer) {
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(layer.canvas, this.box.x, this.box.y, this.box.w, this.box.h);
      ctx.globalCompositeOperation = "source-over"; // el del líder no se suma: se ve sobre el resto
    }
    const i = this.cars ? this.cars.indexOf(leader) : -1;
    if (i >= 0) {
      // Si el mapa no tiene puentes, todo va en el nivel del suelo.
      const single = !this.layers[1];
      if (!single || !onBridge) this.drawPath(ctx, this.paths[i], leader, single ? -1 : level, colors.leader);
    }
    ctx.restore();
  }

  // level: -1 pinta el recorrido entero; 0 o 1, solo los tramos de ese nivel.
  drawPath(ctx, path, car, level, color) {
    ctx.beginPath();
    let open = false;
    for (let k = 3; k < path.length; k += 3) {
      if (level < 0 || path[k + 2] === level) {
        if (!open) ctx.moveTo(path[k - 3], path[k - 2]);
        ctx.lineTo(path[k], path[k + 1]);
        open = true;
      } else open = false;
    }
    // Del último punto guardado a donde está el coche ahora mismo.
    if (level < 0 || (car.level ? 1 : 0) === level) {
      if (!open) ctx.moveTo(path[path.length - 3], path[path.length - 2]);
      ctx.lineTo(car.x, car.y);
    }
    ctx.strokeStyle = color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.28; // halo
    ctx.lineWidth = TRAIL_WIDTH * 2.8;
    ctx.stroke();
    ctx.globalAlpha = 0.95; // trazo
    ctx.lineWidth = TRAIL_WIDTH * 0.9;
    ctx.stroke();
  }
}
