"use strict";
// Mis mapas: guardar, abrir, exportar e importar, plantillas y barrios reales.
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

(() => {
  const {
    $, $$, armed, brainStore, buildWorld, fitView, keyFor, mapEdited, persist, syncControls, toast,
    ui, validBrain
  } = CN;

  // Las funciones se elevan: se comparten desde el principio.
  Object.assign(CN, {
    currentMapData,
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
    const { x, y, angle } = CN.world.start;
    const data = { ...CN.world.graph.toJSON(), start: { x: Math.round(x), y: Math.round(y), angle } };
    if (CN.world.goal) data.goal = { x: Math.round(CN.world.goal.x), y: Math.round(CN.world.goal.y) };
    return data;
  }

  const validGoal = (g) => !!g && Number.isFinite(g.x) && Number.isFinite(g.y);

  // realKey: el barrio real del que sale el mapa (para mostrar el crédito de OSM).
  function openMap(data, realKey = null) {
    CN.world.graph = Graph.fromJSON(data);
    CN.world.start = { ...data.start };
    CN.world.goal = validGoal(data.goal) ? { x: data.goal.x, y: data.goal.y } : null;
    ui.realMap = realKey;
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
    if (!CN.world.graph.segments.length) {
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
    if (!CN.world.graph.segments.length) {
      toast("El mapa está vacío: traza alguna carretera antes de exportarlo.");
      return;
    }
    const name = $("#map-name").value.trim() || "Mi mapa";
    const map = currentMapData();
    const key = keyFor(map, ui.learn);
    const training = key === ui.trainedKey && CN.sim.brain ? CN.sim.training() : brainStore.get(key);
    const file = { formato: "carreteras-neuronales", version: 1, nombre: name, mapa: map, modo: ui.learn, entrenamiento: training || null };
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
    const validSegment = (s) =>
      Array.isArray(s) &&
      (s.length === 2 || (s.length === 3 && ROAD_TYPES[s[2]])) &&
      [s[0], s[1]].every((i) => Number.isInteger(i) && i >= 0 && i < n) &&
      s[0] !== s[1];
    if (!m.segments.every(validSegment)) return false;
    if (m.goal !== undefined && !validGoal(m.goal)) return false;
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
      // El cerebro se guarda para el modo con el que se entrenó.
      const brain = data.entrenamiento && data.entrenamiento.brain;
      const mode = validBrain(brain) ? (data.modo === "together" ? "together" : "explore") : validBrain(brain, GOAL_INPUTS) ? "goal" : null;
      const training = mode ? data.entrenamiento : null;
      if (training) brainStore.put(keyFor(map, mode), training);
      openMap(map);
      if (data.nombre) $("#map-name").value = String(data.nombre).slice(0, 40);
      toast(`Mapa «${data.nombre || file.name}» importado${training ? " con su cerebro entrenado" : ""}.`);
    } catch {
      toast("Ese archivo no es un mapa válido de Carreteras Neuronales.");
    }
  });

  $("#random-city").addEventListener("click", () => {
    const data = randomCityData();
    openMap(data);
    $("#map-name").value = `Ciudad ${data.seed % 100000}`;
    toast(`Ciudad al azar n.º ${data.seed % 100000}. Guárdala en «Mis mapas» si te gusta.`);
  });

  // Un botón por cada barrio real incluido.
  for (const [key, template] of Object.entries(MAP_TEMPLATES)) {
    if (!template.real) continue;
    const button = document.createElement("button");
    button.className = "btn";
    button.dataset.template = key;
    button.textContent = template.name;
    $("#real-templates").append(button);
  }

  $$("[data-template]").forEach((b) =>
    b.addEventListener("click", () => {
      const template = MAP_TEMPLATES[b.dataset.template];
      openMap(template.build(), template.real ? b.dataset.template : null);
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

  Object.assign(CN, {
    validGoal,
  });
})();
