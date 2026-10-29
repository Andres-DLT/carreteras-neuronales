"use strict";
// Entrenamiento por generaciones (algoritmo genético con elitismo):
// todos salen del mismo punto; el que más terreno explora pasa su cerebro
// a la siguiente generación, intacto en un coche y mutado en el resto.

// Causas de eliminación, en el orden fijo en que se cuentan y se grafican.
const CAUSES = ["choque", "semáforo", "atropello", "atascado", "en pista"];

class Simulation {
  constructor(
    world,
    {
      count = 120,
      mutation = 0.15,
      brain = null,
      record = 0,
      history = [],
      causes = [],
      generation = 1,
      traffic = 6,
      lights = true,
      pedestrians = true,
    } = {}
  ) {
    this.world = world;
    this.count = count;
    this.mutation = mutation;
    this.trafficCount = traffic; // coches de tráfico por generación
    this.lights = lights; // semáforos en los cruces
    this.pedestrians = pedestrians; // peatones en los pasos de cebra
    this.maxFrames = 60 * 60; // una generación dura como mucho un minuto simulado
    this.scratch = [];
    this.onGeneration = null;
    this.adopt({ brain, record, history, causes, generation });
  }

  // Carga un entrenamiento (el de otro mapa, uno importado o uno vacío) y empieza
  // una generación con él.
  adopt({ brain = null, record = 0, history = [], causes = [], generation = 1 } = {}) {
    // Un cerebro guardado con otra cantidad de entradas (versiones anteriores) no sirve.
    if (brain && brain.levels[0].inputs.length !== BRAIN_INPUTS) brain = null;
    this.brain = brain; // mejor cerebro conocido
    this.record = brain ? record : 0; // celdas exploradas por ese cerebro
    this.history = brain ? [...history] : []; // mejor resultado de cada generación
    this.causes = brain ? [...causes] : []; // cuántos coches cayeron por cada causa, por generación
    this.generation = brain ? generation : 1;
    this.stale = 0;
    this.spawn();
  }

  training() {
    return { brain: this.brain, record: this.record, history: this.history, causes: this.causes, generation: this.generation };
  }

  // Coche 0: copia exacta del mejor. Los demás mutan con intensidad creciente
  // (de ¼ a 2 veces la elegida) y el último 10 % son cerebros nuevos al azar.
  // Si el récord lleva varias generaciones sin mejorar, se explora más.
  spawn() {
    const { x, y, angle } = this.world.start;
    const boost = Math.min(this.stale || 0, 5);
    const fresh = Math.floor(this.count * (0.1 + boost * 0.06));
    const mutation = this.mutation * (1 + boost * 0.4);
    this.cars = [];
    for (let i = 0; i < this.count; i++) {
      let brain = null;
      if (this.brain && i < this.count - fresh) {
        brain = NeuralNetwork.clone(this.brain);
        const spread = 0.25 + 1.75 * (i / Math.max(1, this.count - fresh - 1));
        if (i > 0) NeuralNetwork.mutate(brain, Math.min(1, mutation * spread));
      }
      this.cars.push(new Car(x, y, angle, brain));
    }
    this.leader = this.cars[0];
    this.alive = this.cars.length;
    this.frame = 0;
    const needsTraffic = this.trafficCount > 0 || this.lights || this.pedestrians;
    this.traffic = needsTraffic
      ? new Traffic(this.world, { count: this.trafficCount, lights: this.lights, pedestrians: this.pedestrians })
      : null;
  }

  // Manda el terreno explorado; en empate gana quien sigue en marcha
  // y lleva menos tiempo sin pisar terreno nuevo.
  static score(car) {
    return car.cells.size * 1000 - car.idle - (car.damaged ? 500 : 0);
  }

  step() {
    let alive = 0;
    let leader = null;
    let leaderScore = -Infinity;
    if (this.traffic) this.traffic.update();
    for (const car of this.cars) {
      car.update(this.world.grid, this.scratch, this.traffic);
      if (!car.damaged) alive++;
      const score = Simulation.score(car);
      if (score > leaderScore) {
        leader = car;
        leaderScore = score;
      }
    }
    this.leader = leader;
    this.alive = alive;
    this.frame++;
    if (alive === 0 || this.frame >= this.maxFrames) this.endGeneration();
  }

  endGeneration() {
    const best = this.leader;
    const fitness = best.cells.size;
    const improved = fitness > this.record;
    this.stale = improved ? 0 : (this.stale || 0) + 1;
    if (!this.brain || fitness >= this.record) {
      this.record = fitness;
      this.brain = NeuralNetwork.clone(best.brain);
    }
    this.history.push(fitness);
    if (this.history.length > 300) this.history.shift();
    const tally = Object.fromEntries(CAUSES.map((c) => [c, 0]));
    for (const car of this.cars) tally[car.reason || "en pista"]++;
    this.causes.push(tally);
    if (this.causes.length > 60) this.causes.shift();
    const finished = this.generation;
    this.generation++;
    this.spawn();
    if (this.onGeneration) this.onGeneration({ generation: finished, fitness, improved });
  }

  forget() {
    this.adopt();
  }
}
