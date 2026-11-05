"use strict";
// Entrenamiento turbo: la misma simulación que se ve en pantalla, pero en un hilo
// aparte y sin dibujar, así corre todo lo rápido que permite el procesador sin
// congelar la página. Al terminar cada generación avisa con el entrenamiento actual.

importScripts("math.js", "graph.js", "world.js", "network.js", "car.js", "traffic.js", "scenery.js", "sim.js");

let sim = null;
let running = false;
const CHUNK_MS = 50; // trabaja a ratos para poder atender el mensaje de parar

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "start") {
    // Con la gira todoterreno llegan todos sus mapas; si no, solo el actual.
    const worlds = (msg.tour || [msg.map]).map((m) => new World(Graph.fromJSON(m), m.start));
    sim = new Simulation(worlds[0], { ...msg.options, ...msg.training, worlds });
    sim.onGeneration = ({ fitness, improved }) => {
      postMessage({ type: "generation", training: sim.training(), fitness, improved });
    };
    running = true;
    run();
  } else if (msg.type === "settings" && sim) {
    Object.assign(sim, msg.settings); // se aplica en la siguiente generación
  } else if (msg.type === "stop") {
    running = false;
    postMessage({ type: "stopped", training: sim ? sim.training() : null });
  }
};

function run() {
  if (!running) return;
  const start = performance.now();
  while (running && performance.now() - start < CHUNK_MS) sim.step();
  setTimeout(run, 0);
}
