"use strict";
// Interfaz: editor del mapa, cámara, dibujo y controles del entrenamiento.

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const app = $("#app");
  const canvas = $("#world");
  const ctx = canvas.getContext("2d");
  const netCanvas = $("#net");
  const netCtx = netCanvas.getContext("2d");
  const sparkCanvas = $("#spark");
  const sparkCtx = sparkCanvas.getContext("2d");

  const STORAGE_KEY = "carreteras-neuronales/v1";
  const HIT_RADIUS = 18; // px de pantalla para tocar un punto
  const SEGMENT_HIT = 12; // px de pantalla para tocar un tramo y partirlo
  const DRIVE_ZOOM = 0.85;
  const narrow = matchMedia("(max-width: 720px)").matches;

  const HINTS = {
    add:
      "<b>Toca</b> para poner puntos: cada uno se une al anterior. Toca un punto existente para conectarlo, " +
      "o el último otra vez para terminar el tramo. <b>Arrastra</b> un punto para moverlo y el fondo para desplazarte.",
    erase: "<b>Toca</b> un punto o un tramo de carretera para borrarlo.",
    start: "<b>Toca</b> una carretera para poner la salida. Tócala otra vez para invertir el sentido.",
  };

  const storage = {
    load() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
      } catch {
        return null;
      }
    },
    save(data) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // Sin almacenamiento disponible: el progreso vive solo en esta pestaña.
      }
    },
  };

  // ---------- Colores del tema (los define el CSS; el lienzo los lee) ----------
  let colors = readColors();
  function readColors() {
    const style = getComputedStyle(document.documentElement);
    const get = (name) => style.getPropertyValue(name).trim();
    return {
      grass: get("--grass"),
      grassLine: get("--grass-line"),
      road: get("--road"),
      edge: get("--edge"),
      lane: get("--lane"),
      node: get("--node"),
      amber: get("--amber"),
      accent: get("--accent"),
      car: get("--car"),
      leader: get("--leader"),
      wreck: get("--wreck"),
      glass: get("--glass"),
      ink: get("--ink"),
      muted: get("--muted"),
      panel: get("--panel"),
      signInk: get("--sign-ink"),
      font: get("--f-display"),
      building: get("--building"),
      roof1: get("--roof-1"),
      roof2: get("--roof-2"),
      roof3: get("--roof-3"),
      roofLine: get("--roof-line"),
      tree: get("--tree"),
      treeAlt: get("--tree-alt"),
      treeLight: get("--tree-light"),
      worldShadow: get("--world-shadow"),
      stop: get("--stop"),
      sigBox: get("--sig-box"),
      signal: { red: get("--sig-red"), yellow: get("--sig-amber"), green: get("--sig-green") },
      traffic: [get("--traffic-1"), get("--traffic-2"), get("--traffic-3"), get("--traffic-4")],
      wallShade: get("--wall-shade"),
      trunk: get("--trunk"),
      pedHead: get("--ped-head"),
      line: get("--line"),
      mono: get("--f-mono"),
      causes: [get("--cause-1"), get("--cause-2"), get("--cause-3"), get("--cause-4"), get("--cause-5")],
    };
  }
  const themeChanged = () => {
    colors = readColors();
    chartsDirty = true;
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // ---------- Estado ----------
  let world;
  let sim;
  let dpr = 1;
  const view = { x: 0, y: 0, zoom: DRIVE_ZOOM };
  const ui = {
    mode: "train",
    tool: "add",
    selected: null,
    hover: null,
    pointer: null,
    follow: true,
    playing: true,
    speed: 1,
    showBrain: !narrow,
    showCauses: !narrow,
    view3d: false,
    needsBuild: false,
    mapChanged: false,
    trainedKey: null, // mapa al que pertenece el entrenamiento actual
  };
  let chartsDirty = true;

  function boot(saved) {
    const data = saved && saved.map ? saved : storage.load() || {};
    const map = data.map || defaultMapData();
    world = new World(Graph.fromJSON(map), map.start || defaultMapData().start);
    world.ensureStart();
    sim = new Simulation(world, {
      count: data.count || (narrow ? 60 : 120),
      mutation: data.mutation ?? 0.15,
      brain: validBrain(data.brain) ? data.brain : null,
      record: data.record || 0,
      history: data.history || [],
      causes: data.causes || [],
      generation: data.generation || 1,
      traffic: data.traffic ?? 6,
      lights: data.lights ?? true,
      pedestrians: data.pedestrians ?? true,
    });
    sim.onGeneration = onGeneration;
    ui.trainedKey = mapKey(currentMapData());
    ui.speed = data.speed || 1;
    ui.follow = data.follow ?? true;
    ui.view3d = !!data.view3d;
    if (typeof data.showBrain === "boolean") ui.showBrain = data.showBrain;
    if (typeof data.showCauses === "boolean") ui.showCauses = data.showCauses;

    resize();
    setMode(data.mode === "edit" ? "edit" : "train");
    syncControls();
    requestAnimationFrame(loop);
  }

  function snapshot() {
    // Un récord solo vale para el mapa en que se logró.
    const keepRecord = !ui.mapChanged;
    return {
      map: { ...world.graph.toJSON(), start: { x: Math.round(world.start.x), y: Math.round(world.start.y), angle: world.start.angle } },
      brain: sim.brain,
      record: keepRecord ? sim.record : 0,
      history: keepRecord ? sim.history : [],
      causes: keepRecord ? sim.causes : [],
      generation: keepRecord ? sim.generation : 1,
      count: sim.count,
      mutation: sim.mutation,
      traffic: sim.trafficCount,
      lights: sim.lights,
      pedestrians: sim.pedestrians,
      mode: ui.mode,
      follow: ui.follow,
      speed: ui.speed,
      showBrain: ui.showBrain,
      showCauses: ui.showCauses,
      view3d: ui.view3d,
    };
  }

  // ---------- Cerebro guardado por mapa ----------
  // Cada mapa (identificado por su forma y su salida) guarda su mejor cerebro,
  // así al volver a un mapa no hay que reentrenar.
  const BRAINS_KEY = "carreteras-neuronales/brains";
  const brainStore = {
    all() {
      try {
        return JSON.parse(localStorage.getItem(BRAINS_KEY)) || {};
      } catch {
        return {};
      }
    },
    get(key) {
      const entry = this.all()[key];
      return entry && validBrain(entry.brain) ? entry : null;
    },
    write(all) {
      try {
        localStorage.setItem(BRAINS_KEY, JSON.stringify(all));
      } catch {
        // Sin almacenamiento: el cerebro de cada mapa vive solo en esta pestaña.
      }
    },
    put(key, training) {
      if (!training.brain) return;
      const all = this.all();
      all[key] = { ...training, savedAt: Date.now() };
      const keys = Object.keys(all).sort((a, b) => all[b].savedAt - all[a].savedAt);
      for (const old of keys.slice(20)) delete all[old]; // como mucho 20 mapas
      this.write(all);
    },
    remove(key) {
      const all = this.all();
      delete all[key];
      this.write(all);
    },
  };

  function mapKey(data) {
    const s = JSON.stringify([
      data.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
      data.segments,
      Math.round(data.start.x),
      Math.round(data.start.y),
      Math.round(data.start.angle * 1000),
    ]);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  // Comprueba que un cerebro guardado o importado tiene la forma que espera la red.
  function validBrain(brain) {
    if (!brain || !Array.isArray(brain.levels) || !brain.levels.length) return false;
    const nums = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => Number.isFinite(v));
    let inputs = BRAIN_INPUTS;
    for (const level of brain.levels) {
      const outputs = Array.isArray(level.outputs) ? level.outputs.length : 0;
      if (!outputs || !nums(level.inputs, inputs) || !nums(level.outputs, outputs) || !nums(level.biases, outputs)) return false;
      if (!Array.isArray(level.weights) || level.weights.length !== inputs || !level.weights.every((row) => nums(row, outputs))) return false;
      inputs = outputs;
    }
    return inputs === 4;
  }

  const persist = () => storage.save(snapshot());
  let persistTimer = 0;
  function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 400);
  }

  // ---------- Modos ----------
  function setMode(mode) {
    if (mode === "train") {
      if (ui.needsBuild) buildWorld();
      if (!world.graph.segments.length) {
        toast("Traza al menos una carretera antes de entrenar.");
        mode = "edit";
      } else if (ui.mapChanged) {
        world.ensureStart();
        if (ui.trainedKey) brainStore.put(ui.trainedKey, sim.training());
        const key = mapKey(currentMapData());
        const saved = brainStore.get(key);
        if (saved) {
          sim.adopt(saved);
          toast(`Este mapa ya tenía entrenamiento: récord ${meters(saved.record)}, generación ${saved.generation}.`);
        } else {
          sim.adopt({ brain: sim.brain });
          toast("Mapa nuevo: los coches conservan lo aprendido y empiezan en la generación 1.");
        }
        ui.trainedKey = key;
        ui.mapChanged = false;
        chartsDirty = true;
      }
    }
    ui.mode = mode;
    ui.selected = null;
    app.dataset.mode = mode;
    $("#mode-edit").setAttribute("aria-selected", String(mode === "edit"));
    $("#mode-train").setAttribute("aria-selected", String(mode === "train"));
    if (mode === "edit" || !ui.follow) fitView();
    else view.zoom = DRIVE_ZOOM;
    syncControls();
    persistSoon();
  }

  function buildWorld() {
    // Mientras se arrastra un punto no se recolocan edificios ni árboles.
    world.generate({ scenery: !(gesture && gesture.type === "drag") });
    ui.needsBuild = false;
  }

  function mapEdited() {
    ui.needsBuild = true;
    ui.mapChanged = true;
    syncControls();
    persistSoon();
  }

  // ---------- Bucle principal ----------
  let tick = 0;
  function loop() {
    if (ui.needsBuild) buildWorld();
    if (ui.mode === "train") {
      if (ui.playing) for (let i = 0; i < ui.speed; i++) sim.step();
      if (ui.follow) {
        const ease = 1 - Math.pow(0.88, ui.speed); // a más velocidad, la cámara alcanza antes al líder
        view.x = lerp(view.x, sim.leader.x, ease);
        view.y = lerp(view.y, sim.leader.y, ease);
      }
    }
    draw();
    if (tick++ % 6 === 0) updateHud();
    requestAnimationFrame(loop);
  }

  function onGeneration({ generation, fitness, improved }) {
    if (improved && generation > 1) toast(`Generación ${generation}: nuevo récord, ${meters(fitness)}`);
    if (ui.trainedKey && !ui.mapChanged) brainStore.put(ui.trainedKey, sim.training());
    chartsDirty = true;
    persistSoon();
  }

  const meters = (cells) => `${Math.round(cells * CELL_SIZE * METERS_PER_UNIT)} m`;

  // ---------- Dibujo del mundo ----------
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.grass;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const z = view.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, canvas.width / 2 - view.x * z, canvas.height / 2 - view.y * z);

    drawSurveyGrid();
    world.draw(ctx, colors);
    drawCrosswalks();
    drawStopLines();
    drawStart();
    // Los coches van antes que el paisaje: en 3D los edificios altos pueden taparlos.
    if (ui.mode === "train") {
      drawCars();
      drawPedestrians();
    }
    if (ui.view3d) drawScenery3D(ctx, world.scenery, colors, { x: view.x, y: view.y });
    else {
      drawBuildings(ctx, world.scenery.buildings, colors);
      drawTrees(ctx, world.scenery.trees, colors);
    }
    if (ui.mode === "edit") drawGraph();
    drawSignals();
    if (ui.mode === "train" && ui.showBrain) drawNetwork();
  }

  // ---------- Pasos de cebra y peatones ----------
  function drawCrosswalks() {
    if (!sim.pedestrians) return;
    ctx.fillStyle = colors.stop;
    for (const { c, u } of world.crosswalks) {
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
    if (!sim.traffic) return;
    for (const w of sim.traffic.walkers) {
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.angle);
      ctx.fillStyle = colors.worldShadow;
      ctx.beginPath();
      ctx.ellipse(2.5, 3, 6, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.traffic[w.tone];
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 8.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.pedHead;
      ctx.beginPath();
      ctx.arc(0.5, 0, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Semáforos ----------
  const lightsVisible = () => sim.lights && world.intersections.length > 0;
  const currentLight = (intersection, approach) =>
    ui.mode === "train" && sim.traffic ? lightState(intersection, approach, sim.traffic.frame) : null;

  // Línea de detención sobre el carril de entrada de cada acceso.
  function drawStopLines() {
    if (!lightsVisible()) return;
    const half = ROAD_WIDTH / 2 - 5;
    ctx.strokeStyle = colors.stop;
    ctx.lineWidth = 5;
    ctx.lineCap = "butt";
    ctx.beginPath();
    for (const x of world.intersections) {
      for (const a of x.approaches) {
        ctx.moveTo(a.stop.x, a.stop.y);
        ctx.lineTo(a.stop.x + a.right.x * half, a.stop.y + a.right.y * half);
      }
    }
    ctx.stroke();
  }

  // Semáforo en la acera derecha de cada acceso; en el editor se ven apagados.
  function drawSignals() {
    if (!lightsVisible()) return;
    for (const x of world.intersections) {
      for (const a of x.approaches) {
        const state = currentLight(x, a);
        const px = a.stop.x + a.right.x * (ROAD_WIDTH / 2 + 14);
        const py = a.stop.y + a.right.y * (ROAD_WIDTH / 2 + 14);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(a.u.y, a.u.x));
        ctx.fillStyle = colors.sigBox;
        roundedRect(ctx, -7, -17, 14, 34, 4);
        ctx.fill();
        ["red", "yellow", "green"].forEach((lamp, i) => {
          ctx.globalAlpha = state === lamp ? 1 : 0.22;
          ctx.fillStyle = colors.signal[lamp];
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
    ctx.strokeStyle = colors.grassLine;
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

  // Línea de salida a cuadros atravesando la calzada, con flecha de sentido.
  function drawStart() {
    const { x, y, angle } = world.start;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const size = 9;
    const half = ROAD_WIDTH / 2 - 4;
    for (let row = 0; row < 2; row++) {
      for (let i = 0, yy = -half; yy < half - 0.1; i++, yy += size) {
        ctx.fillStyle = (i + row) % 2 ? colors.node : colors.edge;
        ctx.fillRect(-size + row * size, yy, size, Math.min(size, half - yy));
      }
    }
    if (ui.mode === "edit") {
      ctx.fillStyle = colors.amber;
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
    const g = world.graph;
    const r = 7 / view.zoom;
    ctx.lineWidth = 2 / view.zoom;
    ctx.strokeStyle = colors.node;
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
      ctx.strokeStyle = colors.amber;
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
      ctx.fillStyle = colors.node;
      ctx.fill();
      if (p === ui.selected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
        ctx.strokeStyle = colors.amber;
        ctx.lineWidth = 3 / view.zoom;
        ctx.stroke();
      }
    }
  }

  function drawCars() {
    const leader = sim.leader;
    if (sim.traffic) {
      for (const car of sim.traffic.cars) paintCar(car, colors.traffic[car.color], true, car.speed < 0.4);
    }
    ctx.globalAlpha = 0.28;
    for (const car of sim.cars) {
      if (car !== leader) paintCar(car, car.damaged ? colors.wreck : colors.car, false);
    }
    ctx.globalAlpha = 1;
    drawSensors(leader);
    paintCar(leader, leader.damaged ? colors.wreck : colors.leader, true);
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
      ctx.strokeStyle = colors.node;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = colors.glass;
      roundedRect(ctx, CAR_LENGTH * 0.06, -CAR_WIDTH / 2 + 4, CAR_LENGTH * 0.2, CAR_WIDTH - 8, 3); // parabrisas
      ctx.fill();
      roundedRect(ctx, -CAR_LENGTH * 0.38, -CAR_WIDTH / 2 + 5, CAR_LENGTH * 0.12, CAR_WIDTH - 10, 2); // luneta
      ctx.fill();
      ctx.fillStyle = colors.edge;
      ctx.fillRect(CAR_LENGTH / 2 - 3, -CAR_WIDTH / 2 + 3, 3, 6); // faros
      ctx.fillRect(CAR_LENGTH / 2 - 3, CAR_WIDTH / 2 - 9, 3, 6);
      if (braking) {
        ctx.fillStyle = colors.signal.red; // luces de freno
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
      ctx.strokeStyle = colors.leader;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo((hit || end).x, (hit || end).y);
      ctx.stroke();
      if (hit) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = colors.node;
        ctx.beginPath();
        ctx.moveTo(hit.x, hit.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.leader;
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }

  // ---------- Visualizador de la red ----------
  const OUTPUT_LABELS = ["↑", "←", "→", "↓"];
  function sizeCanvas(c) {
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return { w: c.clientWidth, h: c.clientHeight };
  }

  function drawNetwork() {
    const { w, h } = sizeCanvas(netCanvas);
    if (!w || !h) return;
    const c = netCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const brain = sim.leader.brain;
    const layers = [brain.levels[0].inputs, ...brain.levels.map((l) => l.outputs)];
    const left = 12;
    const right = w - 30;
    const xs = layers.map((_, i) => left + (i / (layers.length - 1)) * (right - left));
    const ys = (n) => Array.from({ length: n }, (_, j) => (n === 1 ? h / 2 : 10 + (j / (n - 1)) * (h - 20)));

    brain.levels.forEach((level, li) => {
      const ya = ys(level.inputs.length);
      const yb = ys(level.outputs.length);
      for (let i = 0; i < level.inputs.length; i++) {
        for (let j = 0; j < level.outputs.length; j++) {
          const weight = level.weights[i][j];
          c.strokeStyle = weight > 0 ? colors.accent : colors.amber;
          c.globalAlpha = Math.min(1, Math.abs(weight)) * 0.75;
          c.lineWidth = 1.2;
          c.beginPath();
          c.moveTo(xs[li], ya[i]);
          c.lineTo(xs[li + 1], yb[j]);
          c.stroke();
        }
      }
    });
    c.globalAlpha = 1;

    layers.forEach((values, li) => {
      const y = ys(values.length);
      values.forEach((v, j) => {
        c.beginPath();
        c.arc(xs[li], y[j], li === 0 ? 5 : 6.5, 0, Math.PI * 2);
        c.fillStyle = colors.panel;
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = colors.muted;
        c.stroke();
        if (v > 0) {
          c.globalAlpha = li === 0 ? Math.max(0.25, v) : 1;
          c.fillStyle = li === 0 ? colors.leader : colors.accent;
          c.fill();
          c.globalAlpha = 1;
        }
      });
    });

    c.font = `600 13px ${colors.font}`;
    c.textBaseline = "middle";
    const out = ys(4);
    OUTPUT_LABELS.forEach((label, j) => {
      c.fillStyle = layers[layers.length - 1][j] ? colors.ink : colors.muted;
      c.fillText(label, right + 12, out[j] + 1);
    });
  }

  function drawSpark() {
    const { w, h } = sizeCanvas(sparkCanvas);
    if (!w || !h) return;
    const c = sparkCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const data = sim.history.slice(-80);
    c.strokeStyle = colors.signInk;
    c.globalAlpha = 0.25;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, h - 0.5);
    c.lineTo(w, h - 0.5);
    c.stroke();
    if (data.length < 2) {
      c.globalAlpha = 0.75;
      c.font = `600 11px ${colors.font}`;
      c.fillStyle = colors.signInk;
      c.textBaseline = "middle";
      c.fillText("La curva aparece tras la 2.ª generación", 0, h / 2);
      c.globalAlpha = 1;
      return;
    }
    const max = Math.max(...data, 1);
    const px = (i) => (i / (data.length - 1)) * (w - 6) + 1;
    const py = (v) => h - 3 - (v / max) * (h - 8);
    c.beginPath();
    data.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))));
    c.globalAlpha = 1;
    c.lineWidth = 2;
    c.lineJoin = "round";
    c.stroke();
    c.lineTo(px(data.length - 1), h);
    c.lineTo(px(0), h);
    c.closePath();
    c.globalAlpha = 0.16;
    c.fillStyle = colors.signInk;
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = colors.leader;
    c.beginPath();
    c.arc(px(data.length - 1), py(data[data.length - 1]), 3.5, 0, Math.PI * 2);
    c.fill();
  }

  // ---------- Cifras ----------
  const setText = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const els = {
    gen: $("#s-gen"),
    alive: $("#s-alive"),
    best: $("#s-best"),
    record: $("#s-record"),
    kmh: $("#s-kmh"),
    scaleLabel: $("#scale-label"),
    scaleBar: $("#scale-bar"),
  };
  let lastSparkLength = -1;

  function updateHud() {
    updateScale();
    if (ui.mode !== "train") return;
    const leader = sim.leader;
    setText(els.gen, String(sim.generation));
    setText(els.alive, `${sim.alive}/${sim.cars.length}`);
    setText(els.best, meters(leader.cells.size));
    setText(els.record, meters(sim.record));
    setText(els.kmh, `${Math.round(leader.kmh)} km/h`);
    if (sim.history.length !== lastSparkLength || tick < 12 || chartsDirty) {
      lastSparkLength = sim.history.length;
      drawSpark();
    }
    if (chartsDirty) {
      chartsDirty = false;
      if (ui.showCauses) drawCauses();
    }
  }

  // ---------- Gráfica: por qué se eliminan ----------
  // Barras apiladas al 100 %: una por generación (las últimas 30), con las causas
  // en orden fijo de abajo arriba y el mismo color siempre para cada causa.
  const CAUSE_LABELS = {
    choque: "Choque",
    semáforo: "Se pasó un rojo",
    atropello: "Atropello",
    atascado: "Atascado",
    "en pista": "En pista al final",
  };
  const CAUSE_BARS = 30;
  const causesCanvas = $("#causes");
  const causesCtx = causesCanvas.getContext("2d");
  const causesTip = $("#causes-tip");
  let causesHover = -1;
  let causesLayout = null;

  function buildCausesLegend() {
    const ul = $("#causes-legend");
    ul.replaceChildren();
    CAUSES.forEach((cause, i) => {
      const li = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.setProperty("--swatch", `var(--cause-${i + 1})`);
      const name = document.createElement("span");
      name.textContent = CAUSE_LABELS[cause];
      const value = document.createElement("b");
      value.dataset.cause = cause;
      value.textContent = "–";
      li.append(swatch, name, value);
      ul.append(li);
    });
  }
  buildCausesLegend();

  function drawCauses() {
    const { w, h } = sizeCanvas(causesCanvas);
    if (!w || !h) return;
    const c = causesCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const data = sim.causes.slice(-CAUSE_BARS);
    const left = 34;
    const right = 2;
    const top = 6;
    const bottom = 16;
    const plotW = w - left - right;
    const plotH = h - top - bottom;
    const slot = plotW / CAUSE_BARS;
    const barW = Math.max(2, slot - 2);

    c.font = `400 10px ${colors.mono}`;
    c.textBaseline = "middle";
    c.textAlign = "right";
    c.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = Math.round(top + plotH * (1 - f)) + 0.5;
      c.strokeStyle = colors.line;
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(w - right, y);
      c.stroke();
      c.fillStyle = colors.muted;
      c.fillText(`${f * 100} %`, left - 5, y);
    }
    if (!data.length) {
      c.textAlign = "left";
      c.fillText("Aparece al terminar la 1.ª generación", left + 6, top + plotH / 2);
      causesLayout = null;
      return;
    }

    // Las más recientes a la derecha, como una línea de tiempo.
    const firstX = left + plotW - data.length * slot;
    data.forEach((g, i) => {
      const total = CAUSES.reduce((s, k) => s + g[k], 0) || 1;
      const x = firstX + i * slot + (slot - barW) / 2;
      const visible = CAUSES.map((k, ci) => ({ v: g[k], ci })).filter((s) => s.v > 0);
      let base = top + plotH;
      c.globalAlpha = causesHover === -1 || causesHover === i ? 1 : 0.4;
      visible.forEach((s, si) => {
        const hh = (plotH * s.v) / total;
        const y = base - hh;
        const gap = si === visible.length - 1 ? 0 : 2; // 2 px de separación entre tramos
        c.fillStyle = colors.causes[s.ci];
        c.beginPath();
        const height = Math.max(0.5, hh - gap);
        if (si === visible.length - 1 && c.roundRect) c.roundRect(x, y, barW, height, [Math.min(4, barW / 2), Math.min(4, barW / 2), 0, 0]);
        else c.rect(x, y + gap, barW, height);
        c.fill();
        base = y;
      });
    });
    c.globalAlpha = 1;

    const firstGen = sim.generation - data.length;
    c.fillStyle = colors.muted;
    c.textBaseline = "alphabetic";
    c.textAlign = "left";
    c.fillText(`gen ${firstGen}`, firstX, h - 3);
    c.textAlign = "right";
    c.fillText(`gen ${sim.generation - 1}`, w - right, h - 3);
    causesLayout = { firstX, slot, data, firstGen };

    // Leyenda: la última generación en cifras (los colores nunca van solos).
    const last = data[data.length - 1];
    $$("#causes-legend b").forEach((b) => (b.textContent = String(last[b.dataset.cause])));
  }

  function showCausesTip(e) {
    if (!causesLayout) return;
    const rect = causesCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = Math.floor((mx - causesLayout.firstX) / causesLayout.slot);
    if (i < 0 || i >= causesLayout.data.length) return hideCausesTip();
    if (i !== causesHover) {
      causesHover = i;
      drawCauses();
    }
    const g = causesLayout.data[i];
    const total = CAUSES.reduce((s, k) => s + g[k], 0) || 1;
    causesTip.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = `Generación ${causesLayout.firstGen + i}`;
    causesTip.append(title);
    CAUSES.forEach((k, ci) => {
      const row = document.createElement("span");
      const sw = document.createElement("i");
      sw.style.setProperty("--swatch", `var(--cause-${ci + 1})`);
      row.append(sw, `${CAUSE_LABELS[k]}: ${g[k]} (${Math.round((g[k] / total) * 100)} %)`);
      causesTip.append(row);
    });
    causesTip.hidden = false;
    const x = causesLayout.firstX + (i + 0.5) * causesLayout.slot;
    const tipW = causesTip.offsetWidth;
    causesTip.style.left = `${clamp(x - tipW / 2, 0, rect.width - tipW)}px`;
  }
  function hideCausesTip() {
    causesTip.hidden = true;
    if (causesHover !== -1) {
      causesHover = -1;
      drawCauses();
    }
  }
  causesCanvas.addEventListener("pointermove", showCausesTip);
  causesCanvas.addEventListener("pointerdown", showCausesTip);
  causesCanvas.addEventListener("pointerleave", hideCausesTip);

  function updateScale() {
    const options = [5, 10, 20, 50, 100, 200, 500];
    const pxPerMeter = view.zoom / METERS_PER_UNIT;
    const m = options.find((o) => o * pxPerMeter >= 60) || options[options.length - 1];
    setText(els.scaleLabel, `${m} m`);
    els.scaleBar.style.width = `${Math.round(m * pxPerMeter)}px`;
  }

  // ---------- Cámara ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    lastSparkLength = -1;
    chartsDirty = true;
  }
  new ResizeObserver(resize).observe(canvas);

  const screenPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p) => ({
    x: (p.x - canvas.clientWidth / 2) / view.zoom + view.x,
    y: (p.y - canvas.clientHeight / 2) / view.zoom + view.y,
  });

  function zoomAt(p, factor) {
    const before = toWorld(p);
    view.zoom = clamp(view.zoom * factor, 0.12, 3);
    const after = toWorld(p);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
  }

  // Encaja el mapa en el hueco que dejan libre la barra superior y la consola.
  function fitView() {
    const points = world.graph.points;
    if (!points.length) {
      view.x = 0;
      view.y = 0;
      view.zoom = 0.6;
      return;
    }
    const box = boundsOf(points);
    const appBox = app.getBoundingClientRect();
    let top = $(".bar").getBoundingClientRect().bottom - appBox.top + 8;
    const side = $(".side");
    if (narrow && ui.mode === "train" && side.offsetParent) top = side.getBoundingClientRect().bottom - appBox.top + 8;
    const dock = $(".dock").getBoundingClientRect();
    const bottom = appBox.bottom - dock.top + 8;
    const sideWidth = !narrow && ui.mode === "train" ? 290 : 0;
    const w = canvas.clientWidth - sideWidth;
    const h = Math.max(120, canvas.clientHeight - top - bottom);
    const pad = ROAD_WIDTH;
    view.zoom = clamp(Math.min(w / (box.maxX - box.minX + pad * 2), h / (box.maxY - box.minY + pad * 2)), 0.12, 1.4);
    view.x = (box.minX + box.maxX) / 2 + sideWidth / 2 / view.zoom;
    view.y = (box.minY + box.maxY) / 2 - (top - bottom) / 2 / view.zoom;
  }

  function setFollow(on) {
    ui.follow = on;
    if (on) view.zoom = DRIVE_ZOOM;
    else fitView();
    syncControls();
    persistSoon();
  }

  // ---------- Gestos: tocar, arrastrar, desplazar, pellizcar ----------
  const pointers = new Map();
  let gesture = null;

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, span: Math.max(distance(a, b), 1) };
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const pos = screenPos(e);
    pointers.set(e.pointerId, pos);
    if (pointers.size === 2) {
      gesture = { type: "pinch", ...pinchInfo() };
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 2) {
      ui.selected = null;
      syncControls();
      return;
    }
    const at = toWorld(pos);
    const hit = ui.mode === "edit" && ui.tool === "add" ? world.graph.nearestPoint(at, HIT_RADIUS / view.zoom) : null;
    gesture = { type: e.button === 1 ? "pan" : "tap", origin: pos, last: pos, at, hit };
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = screenPos(e);
    if (e.pointerType === "mouse") {
      ui.pointer = toWorld(pos);
      ui.hover = ui.mode === "edit" ? world.graph.nearestPoint(ui.pointer, HIT_RADIUS / view.zoom) : null;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, pos);
    if (!gesture) return;

    if (gesture.type === "pinch") {
      if (pointers.size < 2) return;
      const info = pinchInfo();
      zoomAt(info.mid, info.span / gesture.span);
      if (!ui.follow || ui.mode === "edit") {
        view.x -= (info.mid.x - gesture.mid.x) / view.zoom;
        view.y -= (info.mid.y - gesture.mid.y) / view.zoom;
      }
      Object.assign(gesture, info);
      return;
    }
    if (gesture.type === "tap" && distance(pos, gesture.origin) > 6) {
      gesture.type = gesture.hit ? "drag" : "pan";
      if (gesture.type === "pan" && ui.mode === "train" && ui.follow) {
        ui.follow = false;
        syncControls();
      }
    }
    if (gesture.type === "drag") {
      const w = toWorld(pos);
      gesture.hit.x = w.x;
      gesture.hit.y = w.y;
      mapEdited();
    } else if (gesture.type === "pan") {
      view.x -= (pos.x - gesture.last.x) / view.zoom;
      view.y -= (pos.y - gesture.last.y) / view.zoom;
    }
    gesture.last = pos;
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.type === "pinch") {
      if (pointers.size === 1) {
        const [p] = pointers.values();
        gesture = { type: "pan", origin: p, last: p };
      } else gesture = null;
      return;
    }
    if (gesture && gesture.type === "tap" && e.type === "pointerup") handleTap(gesture.at, gesture.hit);
    const wasDrag = gesture && gesture.type === "drag";
    gesture = null;
    if (wasDrag) ui.needsBuild = true; // ahora sí, recoloca edificios y árboles
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") {
      ui.pointer = null;
      ui.hover = null;
    }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(screenPos(e), Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false }
  );

  function handleTap(at, hit) {
    if (ui.mode !== "edit") return;
    const g = world.graph;
    if (ui.tool === "add") {
      if (hit) {
        const connected = hit !== ui.selected && ui.selected && g.addSegment(ui.selected, hit);
        ui.selected = hit === ui.selected ? null : hit;
        if (connected) mapEdited();
        else syncControls();
      } else {
        const near = g.nearestSegment(at, SEGMENT_HIT / view.zoom);
        const p = near ? g.splitSegment(near.segment, near.point) : g.addPoint({ x: at.x, y: at.y });
        if (ui.selected) g.addSegment(ui.selected, p);
        ui.selected = p;
        mapEdited();
      }
    } else if (ui.tool === "erase") {
      const p = g.nearestPoint(at, HIT_RADIUS / view.zoom);
      if (p) {
        g.removePoint(p);
        if (ui.selected === p) ui.selected = null;
        mapEdited();
        return;
      }
      const near = g.nearestSegment(at, ROAD_WIDTH / 2);
      if (near) {
        g.removeSegment(near.segment);
        g.removeOrphans(ui.selected);
        mapEdited();
      }
    } else if (ui.tool === "start") {
      if (distance(at, world.start) < 30) {
        world.start.angle += Math.PI;
        mapEdited();
        return;
      }
      const near = g.nearestSegment(at, ROAD_WIDTH / 2);
      if (!near) {
        toast("Toca sobre una carretera para poner la salida.");
        return;
      }
      const { a, b } = near.segment;
      world.start = { x: near.point.x, y: near.point.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
      mapEdited();
    }
  }

  // ---------- Controles ----------
  function syncControls() {
    $("#play").textContent = ui.playing ? "Pausa" : "Seguir";
    $$("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === ui.speed)));
    $$("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === ui.tool)));
    $("#follow").setAttribute("aria-pressed", String(ui.follow));
    $("#toggle-brain").setAttribute("aria-pressed", String(ui.showBrain));
    $("#brain-card").hidden = !ui.showBrain;
    $("#toggle-causes").setAttribute("aria-pressed", String(ui.showCauses));
    $("#causes-card").hidden = !ui.showCauses;
    $("#view3d").setAttribute("aria-pressed", String(ui.view3d));
    $("#pedestrians").checked = sim.pedestrians;
    $("#finish").disabled = !ui.selected;
    $("#hint").innerHTML = HINTS[ui.tool];
    $("#count").value = sim.count;
    $("#count-out").textContent = sim.count;
    $("#mutation").value = Math.round(sim.mutation * 100);
    $("#mutation-out").textContent = `${Math.round(sim.mutation * 100)} %`;
    $("#traffic").value = sim.trafficCount;
    $("#traffic-out").textContent = trafficLabel(sim.trafficCount);
    $("#lights").checked = sim.lights;
  }

  const trafficLabel = (n) => (n === 0 ? "sin tráfico" : n === 1 ? "1 coche" : `${n} coches`);

  $("#mode-edit").addEventListener("click", () => setMode("edit"));
  $("#mode-train").addEventListener("click", () => setMode("train"));

  $("#play").addEventListener("click", () => {
    ui.playing = !ui.playing;
    syncControls();
  });
  $$("[data-speed]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.speed = Number(b.dataset.speed);
      syncControls();
      persistSoon();
    })
  );
  $("#next").addEventListener("click", () => sim.endGeneration());
  $("#follow").addEventListener("click", () => setFollow(!ui.follow));
  $("#toggle-brain").addEventListener("click", () => {
    ui.showBrain = !ui.showBrain;
    syncControls();
    persistSoon();
  });
  $("#toggle-settings").addEventListener("click", (e) => {
    const panel = $("#settings");
    panel.hidden = !panel.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
  });
  $("#count").addEventListener("input", (e) => {
    sim.count = Number(e.target.value);
    $("#count-out").textContent = sim.count;
    persistSoon();
  });
  $("#mutation").addEventListener("input", (e) => {
    sim.mutation = Number(e.target.value) / 100;
    $("#mutation-out").textContent = `${e.target.value} %`;
    persistSoon();
  });

  // Acciones destructivas: el primer toque arma el botón, el segundo confirma.
  function armed(button, label, action) {
    let timer = 0;
    const original = button.innerHTML;
    button.addEventListener("click", () => {
      if (button.classList.contains("armed")) {
        clearTimeout(timer);
        button.classList.remove("armed");
        button.innerHTML = original;
        action();
        return;
      }
      button.classList.add("armed");
      button.textContent = label;
      timer = setTimeout(() => {
        button.classList.remove("armed");
        button.innerHTML = original;
      }, 3000);
    });
  }
  armed($("#forget"), "Toca otra vez para olvidar", () => {
    sim.forget();
    if (ui.trainedKey) brainStore.remove(ui.trainedKey);
    chartsDirty = true;
    persist();
    toast("Cerebros nuevos al azar: empieza la generación 1.");
  });
  armed($("#clear"), "Toca otra vez para vaciar", () => {
    world.graph.clear();
    ui.selected = null;
    mapEdited();
  });

  $$("[data-tool]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.tool = b.dataset.tool;
      ui.selected = null;
      syncControls();
    })
  );
  $("#finish").addEventListener("click", () => {
    ui.selected = null;
    syncControls();
  });
  $("#traffic").addEventListener("input", (e) => {
    sim.trafficCount = Number(e.target.value);
    $("#traffic-out").textContent = trafficLabel(sim.trafficCount);
    persistSoon();
  });
  $("#lights").addEventListener("change", (e) => {
    sim.lights = e.target.checked;
    persistSoon();
  });
  $("#pedestrians").addEventListener("change", (e) => {
    sim.pedestrians = e.target.checked;
    persistSoon();
  });
  $("#toggle-causes").addEventListener("click", () => {
    ui.showCauses = !ui.showCauses;
    chartsDirty = true;
    syncControls();
    persistSoon();
  });
  $("#view3d").addEventListener("click", () => {
    ui.view3d = !ui.view3d;
    syncControls();
    persistSoon();
  });

  // ---------- Mis mapas ----------
  const MAPS_KEY = "carreteras-neuronales/maps";
  const mapStore = {
    list() {
      try {
        return JSON.parse(localStorage.getItem(MAPS_KEY)) || [];
      } catch {
        return [];
      }
    },
    save(list) {
      try {
        localStorage.setItem(MAPS_KEY, JSON.stringify(list));
        return true;
      } catch {
        return false;
      }
    },
  };

  function currentMapData() {
    const { x, y, angle } = world.start;
    return { ...world.graph.toJSON(), start: { x: Math.round(x), y: Math.round(y), angle } };
  }

  function openMap(data) {
    world.graph = Graph.fromJSON(data);
    world.start = { ...data.start };
    ui.selected = null;
    mapEdited();
    buildWorld();
    fitView();
  }

  function renderMaps() {
    const list = mapStore.list();
    const ul = $("#map-list");
    ul.replaceChildren();
    $("#maps-empty").hidden = list.length > 0;
    for (const item of list) {
      const li = document.createElement("li");
      li.className = "map-item";
      const name = document.createElement("div");
      name.className = "name";
      const title = document.createElement("strong");
      title.textContent = item.name;
      const meta = document.createElement("span");
      const when = new Date(item.savedAt).toLocaleDateString("es", { day: "numeric", month: "short" });
      meta.textContent = `${item.map.segments.length} tramos · ${when}`;
      name.append(title, meta);
      const open = document.createElement("button");
      open.className = "btn";
      open.textContent = "Abrir";
      open.addEventListener("click", () => {
        openMap(item.map);
        toast(`Mapa «${item.name}» abierto.`);
      });
      const remove = document.createElement("button");
      remove.className = "btn danger";
      remove.textContent = "Borrar";
      armed(remove, "¿Seguro?", () => {
        mapStore.save(mapStore.list().filter((m) => m.name !== item.name));
        renderMaps();
      });
      li.append(name, open, remove);
      ul.append(li);
    }
  }

  $("#toggle-maps").addEventListener("click", (e) => {
    const panel = $("#maps");
    panel.hidden = !panel.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) renderMaps();
  });
  $("#save-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#map-name");
    const name = input.value.trim();
    if (!name) {
      toast("Escribe un nombre para el mapa.");
      input.focus();
      return;
    }
    if (!world.graph.segments.length) {
      toast("El mapa está vacío: traza alguna carretera antes de guardarlo.");
      return;
    }
    // Un nombre repetido reemplaza al mapa anterior con ese nombre.
    const list = mapStore.list().filter((m) => m.name.toLowerCase() !== name.toLowerCase());
    list.unshift({ name, map: currentMapData(), savedAt: Date.now() });
    if (mapStore.save(list)) {
      toast(`Mapa «${name}» guardado.`);
      input.value = "";
    } else {
      toast("Este navegador no permite guardar mapas (modo privado o almacenamiento lleno).");
    }
    renderMaps();
  });
  // ---------- Exportar e importar ----------
  // El archivo lleva el mapa y, si existe, el cerebro entrenado en ese mapa.
  const slug = (s) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "mapa";

  $("#export-map").addEventListener("click", () => {
    if (!world.graph.segments.length) {
      toast("El mapa está vacío: traza alguna carretera antes de exportarlo.");
      return;
    }
    const name = $("#map-name").value.trim() || "Mi mapa";
    const map = currentMapData();
    const key = mapKey(map);
    const training = key === ui.trainedKey && sim.brain ? sim.training() : brainStore.get(key);
    const file = { formato: "carreteras-neuronales", version: 1, nombre: name, mapa: map, entrenamiento: training || null };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(name)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(training ? `Descargando ${a.download} con su cerebro entrenado.` : `Descargando ${a.download}.`);
  });

  function validMap(m) {
    const finite = (v) => Number.isFinite(v);
    if (!m || !Array.isArray(m.points) || !Array.isArray(m.segments) || !m.start) return false;
    if (m.points.length > 5000 || m.segments.length > 10000 || !m.segments.length) return false;
    if (!m.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite))) return false;
    const n = m.points.length;
    if (!m.segments.every((s) => Array.isArray(s) && s.length === 2 && s.every((i) => Number.isInteger(i) && i >= 0 && i < n) && s[0] !== s[1])) return false;
    return finite(m.start.x) && finite(m.start.y) && finite(m.start.angle);
  }

  $("#import-map").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const map = data.mapa || data.map;
      if (!validMap(map)) throw new Error("mapa no válido");
      const training = data.entrenamiento && validBrain(data.entrenamiento.brain) ? data.entrenamiento : null;
      if (training) brainStore.put(mapKey(map), training);
      openMap(map);
      if (data.nombre) $("#map-name").value = String(data.nombre).slice(0, 40);
      toast(`Mapa «${data.nombre || file.name}» importado${training ? " con su cerebro entrenado" : ""}.`);
    } catch {
      toast("Ese archivo no es un mapa válido de Carreteras Neuronales.");
    }
  });

  $$("[data-template]").forEach((b) =>
    b.addEventListener("click", () => {
      const template = MAP_TEMPLATES[b.dataset.template];
      openMap(template.build());
      toast(`Plantilla «${template.name}» abierta.`);
    })
  );

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      ui.selected = null;
      syncControls();
    } else if (e.key === " " && ui.mode === "train" && e.target === document.body) {
      e.preventDefault();
      ui.playing = !ui.playing;
      syncControls();
    }
  });
  window.addEventListener("pagehide", persist);

  let toastTimer = 0;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  boot(null);
})();
