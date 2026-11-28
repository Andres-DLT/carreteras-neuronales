"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.js");

const { get } = load(["math", "network"]);
const NeuralNetwork = get("NeuralNetwork");

const SHAPE = [9, 6, 4];
const json = (v) => JSON.stringify(v);

// Todos los pesos y umbrales de una red, en orden.
function params(net) {
  const out = [];
  for (const level of net.levels) {
    out.push(...level.biases);
    for (const row of level.weights) out.push(...row);
  }
  return out;
}

test("network: las salidas son siempre 0 o 1", () => {
  for (let k = 0; k < 50; k++) {
    const net = new NeuralNetwork(SHAPE);
    const inputs = Array.from({ length: SHAPE[0] }, () => Math.random());
    const outputs = NeuralNetwork.feedForward(inputs, net);
    assert.equal(outputs.length, SHAPE[SHAPE.length - 1]);
    for (const v of outputs) assert.ok(v === 0 || v === 1, `salida ${v}`);
  }
});

test("network: mutate(0) no cambia nada", () => {
  const net = new NeuralNetwork(SHAPE);
  const before = json(net);
  NeuralNetwork.mutate(net, 0);
  assert.equal(json(net), before);
});

test("network: mutate(1) deja todos los pesos y umbrales en [-1, 1]", () => {
  const net = new NeuralNetwork(SHAPE);
  // Pesos fuera de rango a propósito: mutate(1) los reemplaza por completo.
  for (const level of net.levels) {
    level.biases = level.biases.map(() => 5);
    level.weights = level.weights.map((row) => row.map(() => -7));
  }
  NeuralNetwork.mutate(net, 1);
  for (const v of params(net)) assert.ok(v >= -1 && v <= 1, `peso ${v}`);
});

test("network: crossover solo hereda valores de los padres", () => {
  for (let k = 0; k < 20; k++) {
    const a = new NeuralNetwork(SHAPE);
    const b = new NeuralNetwork(SHAPE);
    const child = NeuralNetwork.crossover(a, b);
    const pa = params(a);
    const pb = params(b);
    params(child).forEach((v, i) => assert.ok(v === pa[i] || v === pb[i], `posición ${i}`));
  }
});

test("network: crossover de un cerebro consigo mismo es él mismo", () => {
  const a = new NeuralNetwork(SHAPE);
  assert.equal(json(NeuralNetwork.crossover(a, a)), json(a));
});

test("network: clone es una copia profunda", () => {
  const net = new NeuralNetwork(SHAPE);
  const copy = NeuralNetwork.clone(net);
  assert.equal(json(copy), json(net));
  copy.levels[0].weights[0][0] = 42;
  copy.levels[1].biases[0] = 42;
  assert.notEqual(net.levels[0].weights[0][0], 42);
  assert.notEqual(net.levels[1].biases[0], 42);
  // La copia piensa igual que el original.
  const inputs = Array.from({ length: SHAPE[0] }, () => Math.random());
  const fresh = NeuralNetwork.clone(net);
  assert.equal(json(NeuralNetwork.feedForward(inputs, fresh)), json(NeuralNetwork.feedForward(inputs, net)));
});
