"use strict";
// Red neuronal de propagación hacia delante, sin entrenamiento por gradiente:
// aprende por evolución (copiar al mejor y mutar sus pesos).
// Cada neurona se activa (1) si la suma ponderada supera su umbral, si no vale 0.

class Level {
  constructor(inputCount, outputCount) {
    this.inputs = new Array(inputCount).fill(0);
    this.outputs = new Array(outputCount).fill(0);
    this.biases = new Array(outputCount).fill(0);
    this.weights = Array.from({ length: inputCount }, () => new Array(outputCount).fill(0));
    Level.randomize(this);
  }

  static randomize(level) {
    for (const row of level.weights) {
      for (let j = 0; j < row.length; j++) row[j] = Math.random() * 2 - 1;
    }
    for (let j = 0; j < level.biases.length; j++) level.biases[j] = Math.random() * 2 - 1;
  }

  static feedForward(inputs, level) {
    for (let i = 0; i < level.inputs.length; i++) level.inputs[i] = inputs[i];
    for (let j = 0; j < level.outputs.length; j++) {
      let sum = 0;
      for (let i = 0; i < level.inputs.length; i++) sum += level.inputs[i] * level.weights[i][j];
      level.outputs[j] = sum > level.biases[j] ? 1 : 0;
    }
    return level.outputs;
  }
}

class NeuralNetwork {
  // neuronCounts: [entradas, ocultas..., salidas]
  constructor(neuronCounts) {
    this.levels = [];
    for (let i = 0; i < neuronCounts.length - 1; i++) {
      this.levels.push(new Level(neuronCounts[i], neuronCounts[i + 1]));
    }
  }

  static feedForward(inputs, network) {
    let outputs = inputs;
    for (const level of network.levels) outputs = Level.feedForward(outputs, level);
    return outputs;
  }

  // Acerca cada peso y umbral a un valor aleatorio; amount = 0 no cambia nada, 1 lo reemplaza.
  static mutate(network, amount) {
    for (const level of network.levels) {
      for (let j = 0; j < level.biases.length; j++) {
        level.biases[j] = lerp(level.biases[j], Math.random() * 2 - 1, amount);
      }
      for (const row of level.weights) {
        for (let j = 0; j < row.length; j++) row[j] = lerp(row[j], Math.random() * 2 - 1, amount);
      }
    }
    return network;
  }

  static clone(network) {
    return JSON.parse(JSON.stringify(network));
  }
}
