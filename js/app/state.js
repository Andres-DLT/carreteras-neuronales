"use strict";
// Estado compartido: referencias al DOM, constantes, colores del tema, el mundo y la simulación, arranque y avisos.
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

// Lo que un script de la interfaz comparte con los demás: lo exporta al final con
// Object.assign(CN, {...}); los que cargan después lo leen al empezar y los anteriores
// lo usan como CN.x cuando lo necesitan. Las variables compartidas viven solo en CN.
const CN = {};

(() => {
  // Las funciones se elevan: se comparten desde el principio.
  Object.assign(CN, {
    boot, snapshot, toast,
  });

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const app = $("#app");
  const canvas = $("#world");
  const ctx = canvas.getContext("2d");
  const netCanvas = $("#net");
  const netCtx = netCanvas.getContext("2d");
  const sparkCanvas = $("#spark");
  const sparkCtx = sparkCanvas.getContext("2d");
  const canvas3d = $("#world3d");

  const STORAGE_KEY = "carreteras-neuronales/v1";
  const HIT_RADIUS = 18; // px de pantalla para tocar un punto
  const SEGMENT_HIT = 12; // px de pantalla para tocar un tramo y partirlo
  const DRIVE_ZOOM = 0.85;
  const narrow = matchMedia("(max-width: 720px)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches; // pantalla táctil

  // Qué aprenden los coches (ver sim.js) y cómo se explica en Ajustes.
  const LEARN_NAMES = { explore: "Explorar", goal: "Ir a un destino", together: "Convivir" };
  const LEARN_HELP = {
    explore: "Gana quien más terreno distinto recorre.",
    goal:
      "Gana quien más avanza por la ruta y, si llegan varios, quien llega antes. El destino se pone con la herramienta " +
      "Destino del editor; sin él, van al punto más lejano de la salida. Usa un cerebro aparte, con dos entradas más.",
    together:
      "Cada cerebro conduce un equipo de 6 coches repartidos por el mapa que pueden chocar entre sí; no hay más tráfico. " +
      "El marcador dice por qué lado de la calle circulan: si se alejan del 50 %, han inventado una norma.",
  };

  const HINTS = {
    add:
      "<b>Toca</b> para poner puntos: cada uno se une al anterior. Toca un punto existente para conectarlo, " +
      "o el último otra vez para terminar el tramo. <b>Arrastra</b> un punto para moverlo y el fondo para desplazarte.",
    erase: "<b>Toca</b> un punto o un tramo de carretera para borrarlo.",
    start: "<b>Toca</b> una carretera para poner la salida. Tócala otra vez para invertir el sentido.",
    goal:
      "<b>Toca</b> una calle para poner el destino del modo «Ir a un destino». Toca el destino otra vez para quitarlo: " +
      "entonces van al punto más lejano de la salida.",
    type:
      "<b>Toca</b> un tramo para cambiar su tipo: calle → avenida → sentido único (en un sentido y en el otro) → " +
      "puente → calle. Un puente cruza por encima de otras calles sin formar cruce.",
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
  CN.colors = readColors();
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
      trail: get("--trail"),
      spark: get("--spark"),
      night: get("--night") === "1", // la vista 3D es de noche con el tema oscuro
      player: get("--player"), // el coche que conduces tú
    };
  }
  const themeChanged = () => {
    CN.colors = readColors();
    CN.chartsDirty = true;
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // ---------- Estado ----------
  CN.world = undefined;
  CN.sim = undefined;
  CN.dpr = 1;
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
    driving: false, // conduces tú un coche
    learn: "explore", // qué aprenden: explore, goal o together
    trails: true, // estelas de luz de los coches
    camera: "chase", // cámara de la vista 3D al seguir un coche: chase, cockpit, drone o director
    sound: false,
    hour: "auto", // hora del día en la vista 3D: auto (según el tema), day, sunset o night
    weather: "clear", // clima en la vista 3D: clear, rain o fog
    needsBuild: false,
    mapChanged: false,
    trainedKey: null, // mapa al que pertenece el entrenamiento actual
  };
  CN.chartsDirty = true;
  const trails = new Trails(2048);

  function boot(saved) {
    const data = saved && saved.map ? saved : storage.load() || {};
    const map = data.map || defaultMapData();
    CN.world = new World(Graph.fromJSON(map), map.start || defaultMapData().start, CN.validGoal(map.goal) ? map.goal : null);
    CN.world.ensureStart();
    // El entrenamiento guardado es el de la gira si estaba activa al cerrar.
    ui.tour = !!data.tour;
    ui.realMap = data.realMap || null;
    ui.learn = MODES.includes(data.learn) ? data.learn : "explore";
    CN.sim = new Simulation(CN.world, {
      worlds: ui.tour ? CN.buildTour() : null,
      count: data.count || (narrow ? 60 : 120),
      mutation: data.mutation ?? 0.15,
      brain: CN.validBrain(data.brain, Simulation.shape(ui.learn)[0]) ? data.brain : null,
      mode: ui.learn,
      record: data.record || 0,
      history: data.history || [],
      causes: data.causes || [],
      generation: data.generation || 1,
      traffic: data.traffic ?? 6,
      lights: data.lights ?? true,
      pedestrians: data.pedestrians ?? true,
    });
    CN.sim.onGeneration = CN.onGeneration;
    ui.trainedKey = CN.trainingKey();
    ui.speed = data.speed || 1;
    ui.follow = data.follow ?? true;
    ui.view3d = !!data.view3d;
    if (ui.view3d) CN.loadView3D();
    ui.trails = data.trails ?? true;
    ui.hour = data.hour || "auto";
    ui.camera = CN.CAMERAS[data.camera] ? data.camera : "chase";
    // El sonido guardado como activo empieza con el primer toque o tecla: el navegador
    // no deja sonar antes.
    ui.sound = !!data.sound && Sound.supported;
    if (ui.sound) {
      const wake = () => CN.sound.enable(ui.sound);
      window.addEventListener("pointerdown", wake, { once: true });
      window.addEventListener("keydown", wake, { once: true });
    }
    ui.weather = data.weather || "clear";
    if (typeof data.showBrain === "boolean") ui.showBrain = data.showBrain;
    if (typeof data.showCauses === "boolean") ui.showCauses = data.showCauses;

    CN.resize();
    CN.setMode(data.mode === "edit" ? "edit" : "train");
    CN.syncControls();
    requestAnimationFrame(CN.loop);
  }

  function snapshot() {
    // Un récord solo vale para el mapa en que se logró.
    const keepRecord = !ui.mapChanged;
    return {
      map: CN.currentMapData(),
      learn: ui.learn,
      brain: CN.sim.brain,
      record: keepRecord ? CN.sim.record : 0,
      history: keepRecord ? CN.sim.history : [],
      causes: keepRecord ? CN.sim.causes : [],
      generation: keepRecord ? CN.sim.generation : 1,
      count: CN.sim.count,
      mutation: CN.sim.mutation,
      traffic: CN.sim.trafficCount,
      lights: CN.sim.lights,
      pedestrians: CN.sim.pedestrians,
      mode: ui.mode,
      follow: ui.follow,
      speed: ui.speed,
      showBrain: ui.showBrain,
      showCauses: ui.showCauses,
      view3d: ui.view3d,
      trails: ui.trails,
      hour: ui.hour,
      weather: ui.weather,
      camera: ui.camera,
      sound: ui.sound,
      tour: ui.tour,
      realMap: ui.realMap || null,
    };
  }

  let toastTimer = 0;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  Object.assign(CN, {
    $, $$, app, canvas, canvas3d, coarse, ctx, DRIVE_ZOOM, HINTS, HIT_RADIUS, LEARN_HELP, LEARN_NAMES,
    narrow, netCanvas, netCtx, SEGMENT_HIT, sparkCanvas, sparkCtx, storage, trails, ui, view,
  });
})();
