"use strict";
// Paneles y controles: visualizador de la red, cifras, gráfica de bajas, sincronía de los controles y sus eventos.
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

(() => {
  const {
    $, $$, brainStore, CAMERAS, coarse, HINTS, LEARN_HELP, loadView3D, mapEdited, meters,
    netCanvas, netCtx, persist, persistSoon, recordText, sendTurboSettings, setLearn, setMode,
    setTour, sparkCanvas, sparkCtx, startTurbo, stopTurbo, subject, toast, trails, turbo, ui, view
  } = CN;

  // Las funciones se elevan: se comparten desde el principio.
  Object.assign(CN, {
    armed, drawNetwork, syncControls, updateHud,
  });

  // ---------- Visualizador de la red ----------
  const OUTPUT_LABELS = ["↑", "←", "→", "↓"];
  function sizeCanvas(c) {
    const w = Math.round(c.clientWidth * CN.dpr);
    const h = Math.round(c.clientHeight * CN.dpr);
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
    c.setTransform(CN.dpr, 0, 0, CN.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const brain = CN.sim.leader.brain;
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
          c.strokeStyle = weight > 0 ? CN.colors.accent : CN.colors.amber;
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
        c.fillStyle = CN.colors.panel;
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = CN.colors.muted;
        c.stroke();
        if (v > 0.02) {
          // Las entradas son continuas (la intensidad muestra el valor); las demás, 0 o 1.
          c.globalAlpha = li === 0 ? Math.max(0.25, v) : 1;
          c.fillStyle = li === 0 ? CN.colors.leader : CN.colors.accent;
          c.fill();
          c.globalAlpha = 1;
        }
      });
    });

    c.font = `600 13px ${CN.colors.font}`;
    c.textBaseline = "middle";
    const out = ys(4);
    OUTPUT_LABELS.forEach((label, j) => {
      c.fillStyle = layers[layers.length - 1][j] > 0.5 ? CN.colors.ink : CN.colors.muted;
      c.fillText(label, right + 12, out[j] + 1);
    });
  }

  function drawSpark() {
    const { w, h } = sizeCanvas(sparkCanvas);
    if (!w || !h) return;
    const c = sparkCtx;
    c.setTransform(CN.dpr, 0, 0, CN.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const data = CN.sim.history.slice(-80);
    c.strokeStyle = CN.colors.signInk;
    c.globalAlpha = 0.25;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, h - 0.5);
    c.lineTo(w, h - 0.5);
    c.stroke();
    if (data.length < 2) {
      c.globalAlpha = 0.75;
      c.font = `600 11px ${CN.colors.font}`;
      c.fillStyle = CN.colors.signInk;
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
    c.fillStyle = CN.colors.signInk;
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = CN.colors.leader;
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
    you: $("#s-you"),
    scaleLabel: $("#scale-label"),
    scaleBar: $("#scale-bar"),
  };
  CN.lastSparkLength = -1;

  function updateHud() {
    updateScale();
    // Crédito de OpenStreetMap mientras se ve un barrio real.
    const showingReal = ui.mode === "train" && CN.sim.touring && ui.tourMaps ? ui.tourMaps[CN.sim.heat].real : !!ui.realMap;
    $("#osm-credit").hidden = !showingReal;
    if (ui.mode !== "train") return;
    const leader = CN.sim.leader;
    setText(els.gen, String(CN.sim.generation));
    setText(els.alive, `${CN.sim.alive}/${CN.sim.cars.length}`);
    const route = CN.sim.mode === "goal" ? CN.sim.route : null;
    setText(els.best, route ? (leader.arrived ? "llegó" : `${Math.round((100 * leader.progress) / route.length)} %`) : meters(leader.cells.size));
    setText(els.record, recordText(CN.sim.record));
    const heat = $("#s-heat");
    const notes = [];
    if (CN.sim.touring && ui.tourMaps) notes.push(`Mapa ${CN.sim.heat + 1} de ${CN.sim.worlds.length} · ${ui.tourMaps[CN.sim.heat].name}`);
    if (CN.sim.mode === "goal") notes.push(route ? `Ruta de ${Math.round(route.length * METERS_PER_UNIT)} m hasta el destino` : "No hay ruta hasta el destino");
    if (CN.sim.mode === "together") {
      const right = CN.sim.lastSide === null ? null : Math.round(CN.sim.lastSide * 100);
      notes.push(right === null ? "Equipos de 6 coches que se cruzan" : `Circulan por la derecha el ${right} %, por la izquierda el ${100 - right} %`);
    }
    heat.hidden = !notes.length;
    if (notes.length) setText(heat, notes.join(" · "));
    setText(els.kmh, `${Math.round(subject().kmh)} km/h`);
    if (CN.sim.player) setText(els.you, meters(CN.sim.player.cells.size));
    if (turbo.on) {
      const seconds = (performance.now() - turbo.started) / 1000;
      const rate = seconds > 0.5 ? (turbo.gens / seconds).toFixed(1).replace(".", ",") : "–";
      const where = turbo.fallback ? "en esta pestaña" : "en segundo plano";
      setText(
        $("#turbo-status"),
        `Turbo ${where}: ${turbo.gens} generaciones · ${rate} por segundo. Los coches se ven parados en la salida mientras tanto.`
      );
    }
    if (CN.sim.history.length !== CN.lastSparkLength || CN.tick < 12 || CN.chartsDirty) {
      CN.lastSparkLength = CN.sim.history.length;
      drawSpark();
    }
    if (CN.chartsDirty) {
      CN.chartsDirty = false;
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
    c.setTransform(CN.dpr, 0, 0, CN.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const data = CN.sim.causes.slice(-CAUSE_BARS);
    const left = 34;
    const right = 2;
    const top = 6;
    const bottom = 16;
    const plotW = w - left - right;
    const plotH = h - top - bottom;
    const slot = plotW / CAUSE_BARS;
    const barW = Math.max(2, slot - 2);

    c.font = `400 10px ${CN.colors.mono}`;
    c.textBaseline = "middle";
    c.textAlign = "right";
    c.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = Math.round(top + plotH * (1 - f)) + 0.5;
      c.strokeStyle = CN.colors.line;
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(w - right, y);
      c.stroke();
      c.fillStyle = CN.colors.muted;
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
        c.fillStyle = CN.colors.causes[s.ci];
        c.beginPath();
        const height = Math.max(0.5, hh - gap);
        if (si === visible.length - 1 && c.roundRect) c.roundRect(x, y, barW, height, [Math.min(4, barW / 2), Math.min(4, barW / 2), 0, 0]);
        else c.rect(x, y + gap, barW, height);
        c.fill();
        base = y;
      });
    });
    c.globalAlpha = 1;

    const firstGen = CN.sim.generation - data.length;
    c.fillStyle = CN.colors.muted;
    c.textBaseline = "alphabetic";
    c.textAlign = "left";
    c.fillText(`gen ${firstGen}`, firstX, h - 3);
    c.textAlign = "right";
    c.fillText(`gen ${CN.sim.generation - 1}`, w - right, h - 3);
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

  // ---------- Controles ----------
  function syncControls() {
    $("#play").textContent = ui.playing ? "Pausa" : "Seguir";
    $("#turbo").setAttribute("aria-pressed", String(turbo.on));
    $("#turbo").textContent = turbo.on ? "Detener turbo" : "Turbo";
    for (const id of ["#play", "#next"]) $(id).disabled = turbo.on;
    $$("[data-speed]").forEach((b) => (b.disabled = turbo.on || ui.driving));
    $("#turbo").disabled = ui.driving;
    $("#drive").setAttribute("aria-pressed", String(ui.driving));
    $("#pad").hidden = !(ui.driving && coarse);
    $("#stat-you").hidden = !ui.driving;
    $("#turbo-status").hidden = !turbo.on;
    $$("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === ui.speed)));
    $$("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === ui.tool)));
    $("#follow").setAttribute("aria-pressed", String(ui.follow));
    $("#toggle-brain").setAttribute("aria-pressed", String(ui.showBrain));
    $("#brain-card").hidden = !ui.showBrain;
    $("#toggle-causes").setAttribute("aria-pressed", String(ui.showCauses));
    $("#causes-card").hidden = !ui.showCauses;
    $("#view3d").setAttribute("aria-pressed", String(ui.view3d));
    $("#camera").hidden = !ui.view3d || ui.mode !== "train";
    $("#camera").textContent = `Cámara: ${CAMERAS[ui.camera]}`;
    $("#sound").setAttribute("aria-pressed", String(ui.sound));
    $("#sound").hidden = !Sound.supported;
    $("#pedestrians").checked = CN.sim.pedestrians;
    $("#trails").checked = ui.trails;
    $("#hour").value = ui.hour;
    $("#weather").value = ui.weather;
    $("#tour").checked = ui.tour;
    $("#learn").value = ui.learn;
    $("#learn-help").textContent = LEARN_HELP[ui.learn];
    $("#brain-legend").textContent =
      ui.learn === "goal"
        ? "7 sensores + rojo + obstáculo + rumbo de la ruta → 8 neuronas → acelerar, girar, frenar"
        : "7 sensores + rojo + obstáculo delante → 6 neuronas → acelerar, girar, frenar";
    $("#finish").disabled = !ui.selected;
    $("#hint").innerHTML = HINTS[ui.tool];
    $("#count").value = CN.sim.count;
    $("#count-out").textContent = CN.sim.count;
    $("#mutation").value = Math.round(CN.sim.mutation * 100);
    $("#mutation-out").textContent = `${Math.round(CN.sim.mutation * 100)} %`;
    $("#traffic").value = CN.sim.trafficCount;
    $("#traffic-out").textContent = trafficLabel(CN.sim.trafficCount);
    $("#lights").checked = CN.sim.lights;
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
  $("#next").addEventListener("click", () => CN.sim.finishHeat());
  $("#tour").addEventListener("change", (e) => setTour(e.target.checked));
  $("#learn").addEventListener("change", (e) => setLearn(e.target.value));
  $("#turbo").addEventListener("click", () => (turbo.on ? stopTurbo() : startTurbo()));
  $("#follow").addEventListener("click", () => CN.setFollow(!ui.follow));
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
    CN.sim.count = Number(e.target.value);
    $("#count-out").textContent = CN.sim.count;
    sendTurboSettings();
    persistSoon();
  });
  $("#mutation").addEventListener("input", (e) => {
    CN.sim.mutation = Number(e.target.value) / 100;
    $("#mutation-out").textContent = `${e.target.value} %`;
    sendTurboSettings();
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
    if (turbo.on) {
      turbo.mapKey = null; // lo que devuelva el turbo ya no se aplica
      stopTurbo();
    }
    CN.sim.forget();
    if (ui.trainedKey) brainStore.remove(ui.trainedKey);
    CN.chartsDirty = true;
    persist();
    toast("Cerebros nuevos al azar: empieza la generación 1.");
  });
  armed($("#clear"), "Toca otra vez para vaciar", () => {
    CN.world.graph.clear();
    CN.world.goal = null;
    ui.realMap = null;
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
    CN.sim.trafficCount = Number(e.target.value);
    $("#traffic-out").textContent = trafficLabel(CN.sim.trafficCount);
    sendTurboSettings();
    persistSoon();
  });
  $("#lights").addEventListener("change", (e) => {
    CN.sim.lights = e.target.checked;
    sendTurboSettings();
    persistSoon();
  });
  $("#pedestrians").addEventListener("change", (e) => {
    CN.sim.pedestrians = e.target.checked;
    sendTurboSettings();
    persistSoon();
  });
  $("#trails").addEventListener("change", (e) => {
    ui.trails = e.target.checked;
    if (!ui.trails) trails.reset(); // libera los lienzos
    persistSoon();
  });
  $("#hour").addEventListener("change", (e) => {
    ui.hour = e.target.value;
    persistSoon();
  });
  $("#weather").addEventListener("change", (e) => {
    ui.weather = e.target.value;
    persistSoon();
  });
  $("#toggle-causes").addEventListener("click", () => {
    ui.showCauses = !ui.showCauses;
    CN.chartsDirty = true;
    syncControls();
    persistSoon();
  });
  $("#view3d").addEventListener("click", () => {
    ui.view3d = !ui.view3d;
    if (ui.view3d) loadView3D();
    syncControls();
    persistSoon();
  });
})();
