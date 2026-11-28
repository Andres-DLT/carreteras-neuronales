"use strict";
// Bucle principal: avanza la simulación, dibuja cada fotograma y arranca la interfaz.
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

(() => {
  const {
    $, boot, brainStore, buildWorld, canvas3d, CRASH_TEXT, draw, draw3D, live3d, persistSoon,
    recordText, sound, subject, toast, trails, turbo, ui, updateHud, view
  } = CN;

  // Las funciones se elevan: se comparten desde el principio.
  Object.assign(CN, {
    loop, onGeneration,
  });

  // ---------- Bucle principal ----------
  CN.tick = 0;
  CN.stepped = 0; // pasos de simulación dados en este fotograma
  let slowmo = 0; // fotogramas que quedan a cámara lenta
  let recordGen = 0; // generación en la que ya se avisó del récord

  // Récord batido en plena carrera (entrenando en un solo mapa): suena un aviso y, con
  // la cámara de director, se ve unos segundos a cámara lenta.
  function watchRecord() {
    if (CN.sim.mode !== "explore") return;
    if (CN.sim.touring || CN.sim.record <= 0 || recordGen === CN.sim.generation) return;
    if (CN.sim.leader.cells.size <= CN.sim.record) return;
    recordGen = CN.sim.generation;
    sound.record();
    if (live3d() && ui.follow && ui.camera === "director" && !ui.driving) slowmo = 150;
  }

  // Sonido del coche al que sigue la cámara.
  const crashed = new WeakSet();
  function updateSound() {
    const car = subject();
    const running = ui.mode === "train" && ui.playing && !turbo.on;
    sound.update({
      speed: Math.abs(car.speed) / car.maxSpeed,
      throttle: car.controls.forward,
      rain: running && live3d() && ui.weather === "rain",
      active: running && !car.damaged,
    });
    if (car.damaged && !crashed.has(car)) {
      crashed.add(car);
      if (running && car.reason !== "atascado") sound.crash();
    }
  }

  function loop() {
    CN.stepped = 0;
    if (ui.needsBuild) buildWorld();
    if (ui.mode === "train") {
      if (turbo.on) {
        // Sin Web Worker (p. ej. abriendo el archivo directamente): turbo en este
        // hilo, con un presupuesto de tiempo por fotograma para no congelar la página.
        if (turbo.fallback) {
          const start = performance.now();
          while (turbo.on && performance.now() - start < 12) CN.sim.step();
        }
      } else if (ui.playing) {
        // A cámara lenta, un paso cada tres fotogramas.
        CN.stepped = slowmo > 0 ? (slowmo-- % 3 === 0 ? 1 : 0) : ui.speed;
        for (let i = 0; i < CN.stepped; i++) {
          CN.sim.step();
          if (ui.trails) trails.track(CN.sim, CN.colors);
        }
        watchRecord();
      }
      if (ui.follow) {
        const ease = 1 - Math.pow(0.88, ui.speed); // a más velocidad, la cámara alcanza antes al líder
        const focus = subject();
        view.x = lerp(view.x, focus.x, ease);
        view.y = lerp(view.y, focus.y, ease);
      }
      const me = CN.sim.player;
      if (me && me.damaged && !me.told) {
        me.told = true;
        toast(CRASH_TEXT[me.reason] || "Has chocado: vuelves a la salida.");
      }
    }
    if (ui.sound) updateSound();
    const in3d = live3d();
    if (canvas3d.hidden === in3d) {
      canvas3d.hidden = !in3d;
      $(".scale").style.visibility = in3d ? "hidden" : ""; // la escala solo vale para el plano
    }
    if (in3d) draw3D();
    else draw();
    if (CN.tick++ % 6 === 0) updateHud();
    requestAnimationFrame(loop);
  }

  function onGeneration({ generation, fitness, improved }) {
    if (turbo.on) turbo.gens++;
    else if (improved && generation > 1) toast(`Generación ${generation}: nuevo récord, ${recordText(fitness)}`);
    if (ui.trainedKey && !ui.mapChanged) brainStore.put(ui.trainedKey, CN.sim.training());
    CN.chartsDirty = true;
    persistSoon();
  }

  boot(null);
})();
