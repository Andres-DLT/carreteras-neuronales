"use strict";
// El README promete que todo es determinista dentro de una generación: el mejor
// cerebro repite exactamente su resultado y el récord nunca retrocede.
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.js");

const { get } = load();
const Graph = get("Graph");
const World = get("World");
const Simulation = get("Simulation");
const NeuralNetwork = get("NeuralNetwork");
const MAP_TEMPLATES = get("MAP_TEMPLATES");

function circuit() {
  const data = MAP_TEMPLATES.circuito.build();
  const world = new World(Graph.fromJSON(data), data.start, data.goal);
  world.ensureStart();
  return world;
}

// Corre la simulación hasta que termine la generación en curso y devuelve su resultado.
function runGeneration(sim) {
  let result = null;
  sim.onGeneration = (info) => (result = info);
  for (let frames = 0; !result; frames++) {
    if (frames > sim.maxFrames * sim.worlds.length + 10) throw new Error("la generación no termina");
    sim.step();
  }
  return result;
}

test("determinismo: en 3 generaciones el resultado nunca baja del récord anterior", () => {
  const sim = new Simulation(circuit(), { count: 12 });
  let record = null;
  for (let g = 1; g <= 3; g++) {
    const { fitness } = runGeneration(sim);
    if (record !== null) assert.ok(fitness >= record, `generación ${g}: ${fitness} < récord ${record}`);
    assert.ok(sim.record >= (record ?? 0), `el récord retrocedió en la generación ${g}`);
    record = sim.record;
  }
  assert.equal(sim.history.length, 3);
  for (let i = 1; i < sim.history.length; i++) {
    assert.ok(sim.history[i] >= Math.max(...sim.history.slice(0, i)), `historial: ${sim.history.join(", ")}`);
  }
});

test("determinismo: el mismo cerebro puntúa igual dos veces", () => {
  const brain = NeuralNetwork.clone(new NeuralNetwork(Simulation.shape("explore")));
  // Con un solo coche la población es solo la copia exacta del cerebro.
  const score = () => runGeneration(new Simulation(circuit(), { count: 1, brain, record: 0 })).fitness;
  const first = score();
  assert.equal(score(), first);
});
