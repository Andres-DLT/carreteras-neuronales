"use strict";
// Conducir tú: teclado, botones táctiles, cámara de la vista 3D y sonido.
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

(() => {
  const { $, $$, CAMERAS, coarse, persistSoon, setFollow, sound, stopTurbo, syncControls, toast, ui } = CN;

  // Las funciones se elevan: se comparten desde el principio.
  Object.assign(CN, {
    setDriving,
  });

  // ---------- Conducir tú ----------
  // Un coche más, fuera de la población: lo llevas con las flechas, con WASD o con los
  // botones de la pantalla, por el mismo mapa y con las mismas reglas que los demás.
  const pedals = { forward: false, reverse: false, steer: 0 };
  const held = new Set();
  const KEYS = {
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
  };
  const CRASH_TEXT = {
    choque: "Has chocado: vuelves a la salida.",
    semáforo: "Te has pasado un semáforo en rojo: vuelves a la salida.",
    atropello: "Has atropellado a un peatón: vuelves a la salida.",
  };

  function readPedals() {
    pedals.forward = held.has("up");
    pedals.reverse = held.has("down");
    pedals.steer = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
  }

  function setDriving(on) {
    if (on && ui.mode !== "train") return;
    ui.driving = on;
    held.clear();
    readPedals();
    if (on) {
      stopTurbo();
      ui.speed = 1; // a tiempo real, o no habría quien lo condujera
      ui.playing = true;
      CN.sim.drive(pedals);
      if (!ui.follow) setFollow(true);
      toast(
        coarse
          ? "Conduce con los botones de la pantalla. Chocar o pasarte un rojo te devuelve a la salida."
          : "Conduce con las flechas o con WASD. Chocar o pasarte un rojo te devuelve a la salida."
      );
    } else CN.sim.stopDriving();
    syncControls();
  }

  window.addEventListener("keydown", (e) => {
    const key = KEYS[e.key];
    if (!key || !ui.driving || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    e.preventDefault();
    held.add(key);
    readPedals();
  });
  window.addEventListener("keyup", (e) => {
    const key = KEYS[e.key];
    if (!key) return;
    held.delete(key);
    readPedals();
  });
  window.addEventListener("blur", () => {
    held.clear();
    readPedals();
  });
  $$("[data-pedal]").forEach((button) => {
    const press = (on) => (e) => {
      e.preventDefault();
      if (on) held.add(button.dataset.pedal);
      else held.delete(button.dataset.pedal);
      readPedals();
    };
    button.addEventListener("pointerdown", press(true));
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(type, press(false));
  });
  $("#drive").addEventListener("click", () => setDriving(!ui.driving));
  $("#camera").addEventListener("click", () => {
    const order = Object.keys(CAMERAS);
    ui.camera = order[(order.indexOf(ui.camera) + 1) % order.length];
    if (!ui.follow) setFollow(true); // las cámaras son para seguir a un coche
    syncControls();
    persistSoon();
  });
  $("#sound").addEventListener("click", () => {
    ui.sound = !ui.sound;
    sound.enable(ui.sound);
    syncControls();
    persistSoon();
  });

  Object.assign(CN, {
    CRASH_TEXT,
  });
})();
