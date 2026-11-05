"use strict";
// Entrenamiento por generaciones (algoritmo genético con elitismo):
// todos salen del mismo punto; el que más terreno explora pasa su cerebro
// a la siguiente generación, intacto en un coche y mutado en el resto.
//
// Entrenamiento todoterreno: con varios mapas, cada generación corre una manga en
// cada uno con los mismos cerebros, y gana quien cubre más proporción de calle
// sumando todas las mangas (así no basta con memorizar un solo mapa).

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
      worlds = null, // mapas de la gira todoterreno; si no, solo `world`
    } = {}
  ) {
    this.worlds = worlds && worlds.length ? worlds : [world];
    this.world = this.worlds[0];
    this.count = count;
    this.mutation = mutation;
    this.trafficCount = traffic; // coches de tráfico por generación
    this.lights = lights; // semáforos en los cruces
    this.pedestrians = pedestrians; // peatones en los pasos de cebra
    this.maxFrames = 60 * 60; // una manga dura como mucho un minuto simulado
    this.scratch = [];
    this.onGeneration = null;
    this.adopt({ brain, record, history, causes, generation });
  }

  get touring() {
    return this.worlds.length > 1;
  }

  // Cambia los mapas en los que se entrena (uno solo o la gira todoterreno).
  setWorlds(worlds, training) {
    this.worlds = worlds;
    this.adopt(training);
  }

  // Carga un entrenamiento (el de otro mapa, uno importado o uno vacío) y empieza
  // una generación con él.
  adopt({ brain = null, record = 0, history = [], causes = [], generation = 1, stale = 0 } = {}) {
    // Un cerebro guardado con otra cantidad de entradas (versiones anteriores) no sirve.
    if (brain && brain.levels[0].inputs.length !== BRAIN_INPUTS) brain = null;
    this.brain = brain; // mejor cerebro conocido
    this.record = brain ? record : 0; // celdas exploradas por ese cerebro (o % de calle en la gira)
    this.history = brain ? [...history] : []; // mejor resultado de cada generación
    this.causes = brain ? [...causes] : []; // cuántos coches cayeron por cada causa, por generación
    this.generation = brain ? generation : 1;
    this.stale = brain ? stale : 0; // generaciones seguidas sin mejorar el récord
    this.parents = null; // se eligen al terminar la primera generación
    this.spawn();
  }

  training() {
    return {
      brain: this.brain,
      record: this.record,
      history: this.history,
      causes: this.causes,
      generation: this.generation,
      stale: this.stale,
    };
  }

  // Cerebros de la generación. Coche 0: copia exacta del mejor. Hasta el 40 % mutan
  // al mejor con intensidad creciente (de ¼ a 2 veces la elegida); hasta el 85 % son
  // hijos de cruzar dos de los 5 mejores de la generación anterior, con una mutación
  // suave; el resto (10 % o más) son cerebros nuevos al azar. Si el récord se
  // estanca, se explora más.
  spawn() {
    const n = this.count;
    const boost = Math.min(this.stale || 0, 5);
    const fresh = Math.floor(n * (0.1 + boost * 0.06));
    const mutation = this.mutation * (1 + boost * 0.4);
    const mutantsEnd = Math.floor(n * 0.4);
    const crossEnd = Math.min(Math.floor(n * 0.85), n - fresh);
    const parents = this.parents && this.parents.length ? this.parents : null;
    const pick = () => parents[Math.floor(Math.random() * parents.length)];
    this.population = [];
    for (let i = 0; i < n; i++) {
      let brain = null; // null: el coche crea uno al azar
      if (this.brain && i < n - fresh) {
        if (parents && i >= mutantsEnd && i < crossEnd) {
          brain = NeuralNetwork.mutate(NeuralNetwork.crossover(pick(), pick()), Math.min(1, mutation * 0.5));
        } else {
          brain = NeuralNetwork.clone(this.brain);
          const spread = 0.25 + 1.75 * (i / Math.max(1, n - fresh - 1));
          if (i > 0) NeuralNetwork.mutate(brain, Math.min(1, mutation * spread));
        }
      }
      this.population.push(brain);
    }
    this.totals = new Array(n).fill(0); // puntuación acumulada en las mangas
    this.coverage = new Array(n).fill(0); // fracción de calle explorada, sumada
    this.tally = Object.fromEntries(CAUSES.map((c) => [c, 0]));
    this.heat = 0;
    this.startHeat();
  }

  // Una manga: los mismos cerebros salen en el mapa que toca.
  startHeat() {
    this.world = this.worlds[this.heat];
    const { x, y, angle } = this.world.start;
    this.cars = this.population.map((brain) => new Car(x, y, angle, brain));
    this.population = this.cars.map((car) => car.brain); // los cerebros al azar se conservan entre mangas
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
      car.update(this.world, this.scratch, this.traffic);
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
    if (alive === 0 || this.frame >= this.maxFrames) this.finishHeat();
  }

  // Cierra la manga actual (también lo usa el botón "Siguiente").
  finishHeat() {
    const capacity = this.world.cellCapacity || 1;
    this.cars.forEach((car, i) => {
      const share = car.cells.size / capacity;
      // En la gira cuenta la proporción de calle explorada en cada mapa (para que un
      // mapa grande no pese más que uno pequeño), con el mismo desempate de siempre.
      this.totals[i] += this.touring ? share * 1000 - car.idle * 0.001 - (car.damaged ? 0.5 : 0) : Simulation.score(car);
      this.coverage[i] += share;
      this.tally[car.reason || "en pista"]++;
    });
    this.heat++;
    if (this.heat < this.worlds.length) this.startHeat();
    else this.endGeneration();
  }

  endGeneration() {
    const order = this.population.map((_, i) => i).sort((a, b) => this.totals[b] - this.totals[a] || a - b);
    // Los 5 mejores de esta generación serán los padres de los cruces.
    this.parents = order.slice(0, 5).map((i) => NeuralNetwork.clone(this.population[i]));
    const best = order[0];
    // Récord: celdas exploradas con un mapa; % medio de calle explorada en la gira.
    const fitness = this.touring
      ? Math.round((this.coverage[best] / this.worlds.length) * 1000) / 10
      : this.cars[best].cells.size;
    const improved = fitness > this.record;
    this.stale = improved ? 0 : (this.stale || 0) + 1;
    if (!this.brain || fitness >= this.record) {
      this.record = fitness;
      this.brain = NeuralNetwork.clone(this.population[best]);
    }
    this.history.push(fitness);
    if (this.history.length > 300) this.history.shift();
    this.causes.push(this.tally);
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
