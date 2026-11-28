"use strict";
// Dibujo: vista 3D realista y vista en plano (calles, pasos de cebra, semáforos, salida, destino, coches y sensores).
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

(() => {
  const { canvas, canvas3d, ctx, DRIVE_ZOOM, narrow, toast, trails, turbo, ui, view } = CN;

  // Las funciones se elevan: se comparten desde el principio.
  Object.assign(CN, {
    draw, draw3D, loadView3D,
  });

  // ---------- Vista 3D realista ----------
  // three.js pesa lo suyo, así que solo se descarga la primera vez que se pide el 3D.
  // Mientras llega (o si el navegador no tiene WebGL) se ve la vista aérea de siempre.
  CN.view3d = null;
  let view3dState = "idle"; // idle → loading → ready | failed
  const sound = new Sound();
  // Cámaras de la vista 3D, en el orden en que las recorre el botón.
  const CAMERAS = { chase: "detrás", cockpit: "conductor", drone: "dron", director: "director" };

  function loadView3D() {
    if (view3dState !== "idle") return;
    if (!View3D.supported()) {
      view3dState = "failed";
      toast("Este navegador no puede mostrar la vista 3D realista: se usa la vista aérea.");
      return;
    }
    view3dState = "loading";
    const script = document.createElement("script");
    script.src = "vendor/three.min.js";
    script.onload = () => {
      try {
        CN.view3d = new View3D(canvas3d, { small: narrow });
        view3dState = "ready";
        CN.resize();
      } catch (err) {
        fail3D(err);
      }
    };
    script.onerror = () => fail3D(new Error("no se pudo descargar three.js"));
    document.head.appendChild(script);
  }

  function fail3D(err) {
    console.error(err);
    view3dState = "failed";
    canvas3d.hidden = true;
    toast("La vista 3D realista no está disponible: se usa la vista aérea.");
  }

  // El coche al que sigue la cámara: el que conduces tú o, si no, el líder.
  const subject = () => (ui.driving && CN.sim.player ? CN.sim.player : CN.sim.leader);

  // El 3D realista solo se usa entrenando; el editor trabaja siempre sobre el plano.
  const live3d = () => ui.view3d && ui.mode === "train" && view3dState === "ready";

  function draw3D() {
    try {
      CN.view3d.setTheme(CN.colors, ui.hour, ui.weather);
      const style = CN.sim.touring && ui.tourMaps ? ui.tourMaps[CN.sim.heat].key : ui.realMap;
      CN.view3d.setWorld(CN.sim.world, { pedestrians: CN.sim.pedestrians, lights: CN.sim.lights, style: style || null });
      CN.view3d.render({
        sim: CN.sim,
        view,
        subject: subject(),
        follow: ui.follow,
        speed: ui.playing && !turbo.on ? ui.speed : 1,
        steps: CN.stepped,
        camera: ui.camera,
        driveZoom: DRIVE_ZOOM,
        trails: ui.trails ? trails : null,
      });
      if (ui.showBrain) CN.drawNetwork();
    } catch (err) {
      fail3D(err);
    }
  }

  // ---------- Dibujo del mundo ----------
  // Mapa que se ve: el que se edita o, entrenando, el de la manga en curso (en la
  // gira todoterreno cambia de una manga a otra).
  const stage = () => (ui.mode === "train" ? CN.sim.world : CN.world);

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CN.colors.grass;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const z = view.zoom * CN.dpr;
    ctx.setTransform(z, 0, 0, z, canvas.width / 2 - view.x * z, canvas.height / 2 - view.y * z);

    const w = stage();
    drawSurveyGrid();
    w.draw(ctx, CN.colors);
    drawCrosswalks();
    drawStopLines();
    drawStart();
    drawGoal();
    // Los coches van antes que el paisaje: en 3D los edificios altos pueden taparlos.
    // Los puentes tapan lo que pasa por debajo y quedan bajo lo que circula por encima.
    const lit = ui.mode === "train" && ui.trails && trails.world === w;
    if (ui.mode === "train") {
      if (lit) trails.draw(ctx, false, CN.sim.leader, CN.colors);
      drawCars(false);
      drawPedestrians();
    }
    w.drawBridges(ctx, CN.colors);
    if (ui.mode === "train") {
      if (lit) trails.draw(ctx, true, CN.sim.leader, CN.colors);
      drawCars(true);
    }
    if (ui.view3d) drawScenery3D(ctx, w.scenery, CN.colors, { x: view.x, y: view.y });
    else {
      drawBuildings(ctx, w.scenery.buildings, CN.colors);
      drawTrees(ctx, w.scenery.trees, CN.colors);
    }
    if (ui.mode === "edit") drawGraph();
    drawSignals();
    if (ui.mode === "train" && ui.showBrain) CN.drawNetwork();
  }

  // ---------- Pasos de cebra y peatones ----------
  function drawCrosswalks() {
    if (!CN.sim.pedestrians) return;
    ctx.fillStyle = CN.colors.stop;
    for (const { c, u } of stage().crosswalks) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.atan2(u.y, u.x));
      for (let y = -ROAD_WIDTH / 2 + 6; y <= ROAD_WIDTH / 2 - 12; y += 12) {
        ctx.fillRect(-CROSSWALK_DEPTH / 2, y, CROSSWALK_DEPTH, 6);
      }
      ctx.restore();
    }
  }

  // Vistos desde arriba: hombros (con la camiseta de color) y cabeza.
  function drawPedestrians() {
    if (!CN.sim.traffic) return;
    for (const w of CN.sim.traffic.walkers) {
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.angle);
      ctx.fillStyle = CN.colors.worldShadow;
      ctx.beginPath();
      ctx.ellipse(2.5, 3, 6, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = CN.colors.traffic[w.tone];
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 8.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = CN.colors.pedHead;
      ctx.beginPath();
      ctx.arc(0.5, 0, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Semáforos ----------
  const lightsVisible = () => CN.sim.lights && stage().intersections.length > 0;
  const currentLight = (intersection, approach) =>
    ui.mode === "train" && CN.sim.traffic ? lightState(intersection, approach, CN.sim.traffic.frame) : null;

  // Línea de detención sobre el carril de entrada de cada acceso.
  function drawStopLines() {
    if (!lightsVisible()) return;
    ctx.strokeStyle = CN.colors.stop;
    ctx.lineWidth = 5;
    ctx.lineCap = "butt";
    ctx.beginPath();
    for (const x of stage().intersections) {
      for (const a of x.approaches) {
        // En sentido único los dos carriles entran al cruce: la línea cruza toda la calzada.
        const from = roadType(a.segment).oneway ? -(a.half - 5) : 0;
        ctx.moveTo(a.stop.x + a.right.x * from, a.stop.y + a.right.y * from);
        ctx.lineTo(a.stop.x + a.right.x * (a.half - 5), a.stop.y + a.right.y * (a.half - 5));
      }
    }
    ctx.stroke();
  }

  // Semáforo en la acera derecha de cada acceso; en el editor se ven apagados.
  function drawSignals() {
    if (!lightsVisible()) return;
    for (const x of stage().intersections) {
      for (const a of x.approaches) {
        const state = currentLight(x, a);
        const px = a.stop.x + a.right.x * (a.half + 14);
        const py = a.stop.y + a.right.y * (a.half + 14);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(a.u.y, a.u.x));
        ctx.fillStyle = CN.colors.sigBox;
        roundedRect(ctx, -7, -17, 14, 34, 4);
        ctx.fill();
        ["red", "yellow", "green"].forEach((lamp, i) => {
          ctx.globalAlpha = state === lamp ? 1 : 0.22;
          ctx.fillStyle = CN.colors.signal[lamp];
          ctx.beginPath();
          ctx.arc(0, -10 + i * 10, 4.2, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
  }

  // Cuadrícula de 10 m, como la de un plano topográfico.
  function drawSurveyGrid() {
    const step = 10 / METERS_PER_UNIT;
    if (step * view.zoom < 14) return;
    const halfW = canvas.clientWidth / 2 / view.zoom;
    const halfH = canvas.clientHeight / 2 / view.zoom;
    const x0 = Math.floor((view.x - halfW) / step) * step;
    const y0 = Math.floor((view.y - halfH) / step) * step;
    ctx.strokeStyle = CN.colors.grassLine;
    ctx.lineWidth = 1 / view.zoom;
    ctx.beginPath();
    for (let x = x0; x <= view.x + halfW; x += step) {
      ctx.moveTo(x, view.y - halfH);
      ctx.lineTo(x, view.y + halfH);
    }
    for (let y = y0; y <= view.y + halfH; y += step) {
      ctx.moveTo(view.x - halfW, y);
      ctx.lineTo(view.x + halfW, y);
    }
    ctx.stroke();
  }

  // Modo destino: la ruta en línea de puntos y, donde termina, un círculo de llegada
  // con un banderín a cuadros. En el editor se ve mientras se usa la herramienta Destino.
  function drawGoal() {
    if (ui.learn !== "goal" && !(ui.mode === "edit" && ui.tool === "goal")) return;
    const route = stage().route();
    if (!route) return;
    const pts = route.points;
    const end = pts[pts.length - 1];
    const r = end.r || 52;
    ctx.save();
    ctx.strokeStyle = CN.colors.accent;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([1, 17]);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = CN.colors.accent;
    ctx.beginPath();
    ctx.arc(end.x, end.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = CN.colors.node;
    ctx.fillRect(end.x - 2, end.y - 48, 4, 48);
    const size = 7;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = (row + col) % 2 ? CN.colors.node : CN.colors.edge;
        ctx.fillRect(end.x + 2 + col * size, end.y - 48 + row * size, size, size);
      }
    }
    ctx.restore();
  }

  // Línea de salida a cuadros atravesando la calzada, con flecha de sentido.
  function drawStart() {
    const { x, y, angle } = stage().start;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const size = 9;
    const half = ROAD_WIDTH / 2 - 4;
    for (let row = 0; row < 2; row++) {
      for (let i = 0, yy = -half; yy < half - 0.1; i++, yy += size) {
        ctx.fillStyle = (i + row) % 2 ? CN.colors.node : CN.colors.edge;
        ctx.fillRect(-size + row * size, yy, size, Math.min(size, half - yy));
      }
    }
    if (ui.mode === "edit") {
      ctx.fillStyle = CN.colors.amber;
      ctx.beginPath();
      ctx.moveTo(44, 0);
      ctx.lineTo(18, -14);
      ctx.lineTo(18, 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGraph() {
    const g = CN.world.graph;
    const r = 7 / view.zoom;
    ctx.lineWidth = 2 / view.zoom;
    ctx.strokeStyle = CN.colors.node;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (const { a, b } of g.segments) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (ui.tool === "add" && ui.selected && ui.pointer) {
      const target = ui.hover || ui.pointer;
      ctx.setLineDash([10 / view.zoom, 8 / view.zoom]);
      ctx.strokeStyle = CN.colors.amber;
      ctx.lineWidth = 3 / view.zoom;
      ctx.beginPath();
      ctx.moveTo(ui.selected.x, ui.selected.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const p of g.points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p === ui.hover ? r * 1.35 : r, 0, Math.PI * 2);
      ctx.fillStyle = CN.colors.node;
      ctx.fill();
      if (p === ui.selected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
        ctx.strokeStyle = CN.colors.amber;
        ctx.lineWidth = 3 / view.zoom;
        ctx.stroke();
      }
    }
  }

  // onBridge: false pinta los coches a ras de suelo; true, los que van por un puente
  // (que se pintan después del tablero para quedar encima).
  function drawCars(onBridge) {
    const leader = CN.sim.leader;
    const here = (car) => !!car.level === onBridge;
    if (CN.sim.traffic) {
      for (const car of CN.sim.traffic.cars) if (here(car)) paintCar(car, CN.colors.traffic[car.color], true, car.speed < 0.4);
    }
    // Conviviendo, el equipo del líder se ve entero; el resto, tenue como siempre.
    const mates = CN.sim.mode === "together" ? CN.sim.mates : null;
    ctx.globalAlpha = 0.28;
    for (const car of CN.sim.cars) {
      if (car !== leader && here(car) && !(mates && mates.includes(car))) paintCar(car, car.damaged ? CN.colors.wreck : CN.colors.car, false);
    }
    ctx.globalAlpha = 1;
    if (mates) for (const car of mates) if (car !== leader && here(car)) paintCar(car, car.damaged ? CN.colors.wreck : CN.colors.car, true);
    if (here(leader)) {
      drawSensors(leader);
      paintCar(leader, leader.damaged ? CN.colors.wreck : CN.colors.leader, true);
    }
    const me = CN.sim.player;
    if (me && here(me)) paintCar(me, me.damaged ? CN.colors.wreck : CN.colors.player, true, me.controls.reverse);
  }

  function roundedRect(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
  }

  function paintCar(car, color, detailed, braking = false) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = color;
    roundedRect(ctx, -CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 7);
    ctx.fill();
    if (detailed) {
      ctx.strokeStyle = CN.colors.node;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = CN.colors.glass;
      roundedRect(ctx, CAR_LENGTH * 0.06, -CAR_WIDTH / 2 + 4, CAR_LENGTH * 0.2, CAR_WIDTH - 8, 3); // parabrisas
      ctx.fill();
      roundedRect(ctx, -CAR_LENGTH * 0.38, -CAR_WIDTH / 2 + 5, CAR_LENGTH * 0.12, CAR_WIDTH - 10, 2); // luneta
      ctx.fill();
      ctx.fillStyle = CN.colors.edge;
      ctx.fillRect(CAR_LENGTH / 2 - 3, -CAR_WIDTH / 2 + 3, 3, 6); // faros
      ctx.fillRect(CAR_LENGTH / 2 - 3, CAR_WIDTH / 2 - 9, 3, 6);
      if (braking) {
        ctx.fillStyle = CN.colors.signal.red; // luces de freno
        ctx.fillRect(-CAR_LENGTH / 2, -CAR_WIDTH / 2 + 3, 3, 6);
        ctx.fillRect(-CAR_LENGTH / 2, CAR_WIDTH / 2 - 9, 3, 6);
      }
    }
    ctx.restore();
  }

  function drawSensors(car) {
    if (car.damaged) return;
    const { rays, readings } = car.sensor;
    ctx.lineWidth = 2;
    rays.forEach(([start, end], i) => {
      const hit = readings[i];
      ctx.strokeStyle = CN.colors.leader;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo((hit || end).x, (hit || end).y);
      ctx.stroke();
      if (hit) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = CN.colors.node;
        ctx.beginPath();
        ctx.moveTo(hit.x, hit.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = CN.colors.leader;
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }

  Object.assign(CN, {
    CAMERAS, live3d, sound, stage, subject,
  });
})();
