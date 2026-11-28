"use strict";
// Entrenamiento: gira todoterreno, qué aprenden, cerebro guardado por mapa, modos editar/entrenar y turbo en un Web Worker.
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

(() => {
  const { $, app, DRIVE_ZOOM, LEARN_NAMES, snapshot, storage, toast, trails, ui, view } = CN;

  // Las funciones se elevan: se comparten desde el principio.
  Object.assign(CN, {
    buildTour, buildWorld, keyFor, mapEdited, persistSoon, sendTurboSettings, setLearn, setMode, setTour,
    startTurbo, stopTurbo, validBrain,
  });

  // ---------- Entrenamiento todoterreno ----------
  // La gira: tu mapa, una ciudad al azar fija y dos barrios reales. Un cerebro que
  // conduce bien en todos ha aprendido a conducir, no a recorrer un mapa concreto.
  const TOUR_KEY = "todoterreno";
  const TOUR_SEED = 20261105;
  const TOUR_REAL = ["condesa", "eixample"];

  function tourMaps() {
    const list = [
      { name: "Tu mapa", data: CN.currentMapData() },
      { name: "Ciudad al azar", data: randomCityData(TOUR_SEED) },
    ];
    for (const key of TOUR_REAL) {
      if (MAP_TEMPLATES[key]) list.push({ name: MAP_TEMPLATES[key].name, data: MAP_TEMPLATES[key].build(), real: true, key });
    }
    list[0].real = !!ui.realMap;
    list[0].key = ui.realMap || null; // el barrio real, si lo es: la vista 3D lo viste a su estilo
    return list;
  }

  function buildTour() {
    ui.tourMaps = tourMaps();
    return ui.tourMaps.map((m, i) => (i === 0 ? CN.world : new World(Graph.fromJSON(m.data), m.data.start)));
  }

  function setTour(on) {
    if (turbo.on) {
      toast("Detén el turbo antes de cambiar el modo de entrenamiento.");
      $("#tour").checked = ui.tour;
      return;
    }
    if (ui.trainedKey && !ui.mapChanged) brainStore.put(ui.trainedKey, CN.sim.training());
    ui.tour = on;
    const key = trainingKey();
    const saved = brainStore.get(key);
    if (on) {
      CN.sim.setWorlds(buildTour(), saved || { brain: CN.sim.brain });
      toast(
        saved
          ? `Gira todoterreno: sigue el entrenamiento guardado (récord ${saved.record} %).`
          : `Gira todoterreno: ${CN.sim.worlds.length} mapas por generación, empezando con lo aprendido.`
      );
    } else {
      CN.sim.setWorlds([CN.world], saved || { brain: CN.sim.brain });
      toast("Entrenamiento en un solo mapa.");
    }
    ui.trainedKey = key;
    CN.chartsDirty = true;
    CN.syncControls();
    persistSoon();
  }

  // Qué aprenden: cada modo guarda su propio entrenamiento. Explorar y convivir usan
  // la misma red, así que al pasar de uno a otro se parte de lo aprendido.
  function setLearn(mode) {
    if (turbo.on) {
      toast("Detén el turbo antes de cambiar lo que aprenden.");
      $("#learn").value = ui.learn;
      return;
    }
    if (mode === ui.learn || !MODES.includes(mode)) return;
    if (ui.trainedKey && !ui.mapChanged) brainStore.put(ui.trainedKey, CN.sim.training());
    ui.learn = mode;
    const key = trainingKey();
    const saved = brainStore.get(key);
    CN.sim.setMode(mode, saved || { brain: CN.sim.brain });
    ui.trainedKey = key;
    const name = LEARN_NAMES[mode];
    toast(
      saved
        ? `${name}: sigue el entrenamiento guardado, récord ${recordText(saved.record)}.`
        : CN.sim.brain
          ? `${name}: empieza en la generación 1 con lo aprendido.`
          : `${name}: empieza en la generación 1 con cerebros nuevos.`
    );
    CN.chartsDirty = true;
    CN.syncControls();
    persistSoon();
  }

  // El récord se mide en metros con un mapa y en % medio de calle explorada en la gira.
  const recordText = (value) => {
    const percent = `${String(value).replace(".", ",")} %`;
    if (CN.sim.touring) return percent;
    // Hacia un destino: % de la ruta o, si llegó, en cuánto tiempo (ver endGeneration).
    if (CN.sim.mode === "goal") return value > 100 ? `llega en ${Math.max(1, Math.round((1 - (value - 100) / 100) * 60))} s` : percent;
    return meters(value);
  };

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
      return entry && entry.record > 0 && (validBrain(entry.brain) || validBrain(entry.brain, GOAL_INPUTS)) ? entry : null;
    },
    write(all) {
      try {
        localStorage.setItem(BRAINS_KEY, JSON.stringify(all));
      } catch {
        // Sin almacenamiento: el cerebro de cada mapa vive solo en esta pestaña.
      }
    },
    put(key, training) {
      if (!training.brain || !training.record) return; // nada que recordar todavía
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

  // Clave con la que se guarda un entrenamiento: la del mapa (o la de la gira) más el
  // modo, salvo explorar, que conserva la de siempre. Hacia un destino cuenta también
  // dónde está el destino.
  function keyFor(map, mode, tour = false) {
    const base = tour ? TOUR_KEY : mapKey(map);
    if (mode === "explore") return base;
    if (mode === "goal" && !tour && map.goal) return `${base}/goal@${Math.round(map.goal.x)},${Math.round(map.goal.y)}`;
    return `${base}/${mode}`;
  }
  const trainingKey = () => keyFor(CN.currentMapData(), ui.learn, ui.tour);

  // Comprueba que un cerebro guardado o importado tiene la forma que espera la red
  // (inputCount entradas: las de explorar y convivir, o las del modo destino).
  function validBrain(brain, inputCount = BRAIN_INPUTS) {
    if (!brain || !Array.isArray(brain.levels) || !brain.levels.length) return false;
    const nums = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => Number.isFinite(v));
    let inputs = inputCount;
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
    if (mode !== "train") stopTurbo();
    if (mode !== "train" && ui.driving) CN.setDriving(false);
    if (mode === "train") {
      if (ui.needsBuild) buildWorld();
      if (!CN.world.graph.segments.length) {
        toast("Traza al menos una carretera antes de entrenar.");
        mode = "edit";
      } else if (ui.mapChanged) {
        CN.world.ensureStart();
        if (ui.trainedKey) brainStore.put(ui.trainedKey, CN.sim.training());
        const key = trainingKey();
        const saved = ui.tour ? null : brainStore.get(key);
        if (ui.tour) {
          // Tu mapa forma parte de la gira: la gira cambia y su récord vuelve a cero.
          CN.sim.setWorlds(buildTour(), { brain: CN.sim.brain });
          toast("Tu mapa cambió: la gira todoterreno vuelve a la generación 1 con lo aprendido.");
        } else if (saved) {
          CN.sim.adopt(saved);
          toast(`Este mapa ya tenía entrenamiento: récord ${recordText(saved.record)}, generación ${saved.generation}.`);
        } else {
          CN.sim.adopt({ brain: CN.sim.brain });
          toast("Mapa nuevo: los coches conservan lo aprendido y empiezan en la generación 1.");
        }
        ui.trainedKey = key;
        ui.mapChanged = false;
        CN.chartsDirty = true;
      }
    }
    ui.mode = mode;
    ui.selected = null;
    app.dataset.mode = mode;
    $("#mode-edit").setAttribute("aria-selected", String(mode === "edit"));
    $("#mode-train").setAttribute("aria-selected", String(mode === "train"));
    if (mode === "edit" || !ui.follow) CN.fitView();
    else view.zoom = DRIVE_ZOOM;
    CN.syncControls();
    persistSoon();
  }

  function buildWorld() {
    // Mientras se arrastra un punto no se recolocan edificios ni árboles.
    CN.world.generate({ scenery: !(CN.gesture && CN.gesture.type === "drag") });
    trails.reset(); // las estelas eran de las calles de antes
    ui.needsBuild = false;
  }

  function mapEdited() {
    ui.needsBuild = true;
    ui.mapChanged = true;
    CN.syncControls();
    persistSoon();
  }

  // ---------- Entrenamiento turbo ----------
  // La simulación corre en un Web Worker sin dibujar; aquí solo se recibe el
  // entrenamiento al final de cada generación y se muestran las cifras.
  const turbo = { on: false, worker: null, fallback: false, started: 0, gens: 0, mapKey: null };

  const simSettings = () => ({
    count: CN.sim.count,
    mutation: CN.sim.mutation,
    trafficCount: CN.sim.trafficCount,
    lights: CN.sim.lights,
    pedestrians: CN.sim.pedestrians,
  });

  function startTurbo() {
    if (ui.mode !== "train" || turbo.on) return;
    trails.reset(); // el turbo no dibuja: las estelas vuelven a empezar al terminar
    Object.assign(turbo, { on: true, fallback: false, started: performance.now(), gens: 0, mapKey: ui.trainedKey });
    const s = simSettings();
    const options = { count: s.count, mutation: s.mutation, traffic: s.trafficCount, lights: s.lights, pedestrians: s.pedestrians, mode: ui.learn };
    try {
      const worker = new Worker("js/worker.js");
      worker.onmessage = (e) => onTurboMessage(e.data);
      worker.onerror = (e) => {
        e.preventDefault();
        useTurboFallback();
      };
      const tour = CN.sim.touring && ui.tourMaps ? ui.tourMaps.map((m) => m.data) : null;
      worker.postMessage({ type: "start", map: CN.currentMapData(), tour, training: CN.sim.training(), options });
      turbo.worker = worker;
    } catch {
      useTurboFallback();
    }
    CN.syncControls();
  }

  function useTurboFallback() {
    if (turbo.worker) turbo.worker.terminate();
    turbo.worker = null;
    turbo.fallback = true;
  }

  function onTurboMessage(msg) {
    // Si el mapa cambió mientras tanto, ese entrenamiento ya no corresponde.
    const sameMap = turbo.mapKey === ui.trainedKey && !ui.mapChanged;
    if (msg.type === "generation" && sameMap) {
      CN.sim.adopt(msg.training);
      CN.onGeneration({ generation: msg.training.generation - 1, fitness: msg.fitness, improved: msg.improved });
    } else if (msg.type === "stopped") {
      if (msg.training && sameMap) CN.sim.adopt(msg.training);
      finishTurbo();
    }
  }

  function stopTurbo() {
    if (!turbo.on) return;
    if (turbo.worker) turbo.worker.postMessage({ type: "stop" }); // responde con "stopped"
    else finishTurbo();
  }

  function finishTurbo() {
    if (turbo.worker) turbo.worker.terminate();
    const seconds = Math.max(1, Math.round((performance.now() - turbo.started) / 1000));
    const gens = turbo.gens;
    Object.assign(turbo, { on: false, worker: null, fallback: false });
    toast(`Turbo: ${gens} generaciones en ${seconds} s · récord ${recordText(CN.sim.record)}`);
    CN.chartsDirty = true;
    CN.syncControls();
    persist();
  }

  function sendTurboSettings() {
    if (turbo.worker) turbo.worker.postMessage({ type: "settings", settings: simSettings() });
  }

  const meters = (cells) => `${Math.round(cells * CELL_SIZE * METERS_PER_UNIT)} m`;

  Object.assign(CN, {
    brainStore, meters, persist, recordText, trainingKey, turbo,
  });
})();
