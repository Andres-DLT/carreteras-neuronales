"use strict";
// Entrenamiento por generaciones (algoritmo genético con elitismo): el cerebro que
// mejor lo hace pasa a la siguiente generación, intacto en un coche y mutado en el resto.
//
// Qué significa "hacerlo mejor" depende del modo:
//   explore   todos salen del mismo punto y gana quien más terreno distinto recorre.
//   goal      hay un destino y una ruta hasta él: gana quien más avanza por ella y, si
//             llegan varios, quien llega antes. El cerebro recibe dos entradas más, que
//             le dicen hacia dónde queda el siguiente punto de la ruta.
//   together  cada cerebro lleva un equipo de coches repartidos por el mapa que pueden
//             chocar entre sí; puntúa la media del equipo. Como todos piensan igual,
//             solo prosperan las formas de conducir que conviven consigo mismas.
//
// Entrenamiento todoterreno: con varios mapas, cada generación corre una manga en
// cada uno con los mismos cerebros, y gana quien cubre más proporción de calle (o de
// ruta) sumando todas las mangas, así no basta con memorizar un solo mapa.

// Causas de eliminación, en el orden fijo en que se cuentan y se grafican.
const CAUSES = ["choque", "semáforo", "atropello", "atascado", "en pista"];
const MODES = ["explore", "goal", "together"];
const TEAM_SIZE = 6; // coches por cerebro en el modo convivir

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
      mode = "explore",
    } = {}
  ) {
    this.worlds = worlds && worlds.length ? worlds : [world];
    this.world = this.worlds[0];
    this.mode = MODES.includes(mode) ? mode : "explore";
    this.count = count;
    this.mutation = mutation;
    this.trafficCount = traffic; // coches de tráfico por generación
    this.lights = lights; // semáforos en los cruces
    this.pedestrians = pedestrians; // peatones en los pasos de cebra
    this.maxFrames = 60 * 60; // una manga dura como mucho un minuto simulado
    this.scratch = [];
    this.onGeneration = null;
    // El coche que conduce una persona (o null): va por el mismo mapa y con las mismas
    // reglas, pero no forma parte de la población ni cuenta para el entrenamiento.
    this.player = null;
    this.driver = null; // sus mandos
    this.adopt({ brain, record, history, causes, generation });
  }

  get touring() {
    return this.worlds.length > 1;
  }

  // Capas de la red: entradas, neuronas ocultas y las cuatro salidas.
  static shape(mode) {
    return mode === "goal" ? [GOAL_INPUTS, 8, 4] : [BRAIN_INPUTS, 6, 4];
  }

  get shape() {
    return Simulation.shape(this.mode);
  }

  // Cambia los mapas en los que se entrena (uno solo o la gira todoterreno).
  setWorlds(worlds, training) {
    this.worlds = worlds;
    this.adopt(training);
  }

  // Cambia lo que se aprende y empieza con el entrenamiento que se le pase.
  setMode(mode, training) {
    this.mode = MODES.includes(mode) ? mode : "explore";
    this.adopt(training);
  }

  // Carga un entrenamiento (el de otro mapa, uno importado o uno vacío) y empieza
  // una generación con él.
  adopt({ brain = null, record = 0, history = [], causes = [], generation = 1, stale = 0, side = null } = {}) {
    // Un cerebro con otra cantidad de entradas (otro modo, o una versión anterior) no sirve.
    if (brain && brain.levels[0].inputs.length !== this.shape[0]) brain = null;
    this.brain = brain; // mejor cerebro conocido
    this.record = brain ? record : 0; // lo que logró ese cerebro (ver endGeneration)
    this.history = brain ? [...history] : []; // mejor resultado de cada generación
    this.causes = brain ? [...causes] : []; // cuántos coches cayeron por cada causa, por generación
    this.generation = brain ? generation : 1;
    this.stale = brain ? stale : 0; // generaciones seguidas sin mejorar el récord
    this.parents = null; // se eligen al terminar la primera generación
    this.lastSide = brain && Number.isFinite(side) ? side : null; // modo convivir: parte que va por la derecha
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
      side: this.lastSide,
    };
  }

  // Cerebros de la generación (uno por coche o, en el modo convivir, uno por equipo).
  // El 0: copia exacta del mejor. Hasta el 40 % mutan al mejor con intensidad creciente
  // (de ¼ a 2 veces la elegida); hasta el 85 % son hijos de cruzar dos de los 5 mejores
  // de la generación anterior, con una mutación suave; el resto (10 % o más) son
  // cerebros nuevos al azar. Si el récord se estanca, se explora más.
  spawn() {
    const n = this.mode === "together" ? Math.max(4, Math.round(this.count / TEAM_SIZE)) : this.count;
    const boost = Math.min(this.stale || 0, 5);
    const fresh = Math.floor(n * (0.1 + boost * 0.06));
    const mutation = this.mutation * (1 + boost * 0.4);
    const mutantsEnd = Math.floor(n * 0.4);
    const crossEnd = Math.min(Math.floor(n * 0.85), n - fresh);
    const parents = this.parents && this.parents.length ? this.parents : null;
    const pick = () => parents[Math.floor(Math.random() * parents.length)];
    this.population = [];
    for (let i = 0; i < n; i++) {
      let brain = null;
      if (this.brain && i < n - fresh) {
        if (parents && i >= mutantsEnd && i < crossEnd) {
          brain = NeuralNetwork.mutate(NeuralNetwork.crossover(pick(), pick()), Math.min(1, mutation * 0.5));
        } else {
          brain = NeuralNetwork.clone(this.brain);
          const spread = 0.25 + 1.75 * (i / Math.max(1, n - fresh - 1));
          if (i > 0) NeuralNetwork.mutate(brain, Math.min(1, mutation * spread));
        }
      }
      this.population.push(brain || new NeuralNetwork(this.shape));
    }
    this.totals = new Array(n).fill(0); // puntuación acumulada en las mangas
    this.coverage = new Array(n).fill(0); // fracción de calle (o de ruta) cubierta, sumada
    this.tally = Object.fromEntries(CAUSES.map((c) => [c, 0]));
    this.side = { right: 0, total: 0 }; // modo convivir: por qué lado de la calle circulan
    this.heat = 0;
    this.startHeat();
  }

  // Empieza (o deja) de conducir una persona. `controls` son sus mandos, que la
  // interfaz va cambiando: { forward, reverse, steer }.
  drive(controls) {
    this.driver = controls;
    this.spawnPlayer();
  }

  stopDriving() {
    this.driver = null;
    this.player = null;
  }

  // Sale un poco por detrás de la línea de salida, para no nacer dentro de los demás.
  spawnPlayer() {
    const start = this.world.start;
    const { angle } = start;
    const back = { x: start.x - Math.cos(angle) * 64, y: start.y - Math.sin(angle) * 64 };
    const { x, y } = this.world.isOnRoad(back) ? back : start;
    this.player = new Car(x, y, angle);
    this.player.manual = this.driver;
    this.player.home = this.world;
  }

  // Si choca, vuelve a la salida al cabo de segundo y medio.
  stepPlayer() {
    const p = this.player;
    if (!p.damaged) {
      p.update(this.world, this.scratch, this.traffic);
      if (p.damaged) p.wait = 90;
    } else if (--p.wait <= 0) this.spawnPlayer();
  }

  // Una manga: los mismos cerebros salen en el mapa que toca. Cada cerebro lleva un
  // equipo: de un solo coche, salvo en el modo convivir.
  startHeat() {
    this.world = this.worlds[this.heat];
    this.route = this.mode === "goal" ? this.world.route() : null;
    let slots = [this.world.start];
    if (this.mode === "together") {
      const spots = this.world.spots(TEAM_SIZE);
      if (spots.length > 1) slots = spots;
    }
    this.cars = [];
    this.teams = this.population.map((brain) => {
      const team = slots.map(({ x, y, angle }) => {
        const car = new Car(x, y, angle, brain);
        car.route = this.route;
        return car;
      });
      if (team.length > 1) for (const car of team) car.mates = team;
      this.cars.push(...team);
      return team;
    });
    this.leader = this.cars[0];
    this.mates = this.teams[0];
    this.alive = this.cars.length;
    this.frame = 0;
    const count = this.mode === "together" ? 0 : this.trafficCount; // conviviendo, el tráfico son ellos
    const needsTraffic = count > 0 || this.lights || this.pedestrians;
    this.traffic = needsTraffic ? new Traffic(this.world, { count, lights: this.lights, pedestrians: this.pedestrians }) : null;
    // Quien conduce sigue donde iba aunque empiece otra generación, salvo que cambie el mapa.
    if (this.driver && (!this.player || this.player.home !== this.world)) this.spawnPlayer();
  }

  // Manda el terreno explorado; en empate gana quien sigue en marcha
  // y lleva menos tiempo sin pisar terreno nuevo.
  static score(car) {
    return car.cells.size * 1000 - car.idle - (car.damaged ? 500 : 0);
  }

  // Puntuación de un coche en la manga en curso. Hacia un destino manda lo avanzado
  // por la ruta y, entre los que llegan, haber tardado menos.
  scoreOf(car) {
    if (this.mode !== "goal" || !this.route) return Simulation.score(car);
    return car.progress * 10 + (car.arrived ? 1e6 + (this.maxFrames - car.arrivedAt) * 10 : 0) - (car.damaged ? 50 : 0);
  }

  // Fracción cubierta, de 0 a 1: de la calle del mapa o, hacia un destino, de la ruta.
  shareOf(car) {
    if (this.mode === "goal" && this.route) return car.arrived ? 1 : car.progress / this.route.length;
    return car.cells.size / (this.world.cellCapacity || 1);
  }

  step() {
    let alive = 0;
    let best = 0;
    let bestScore = -Infinity;
    if (this.traffic) this.traffic.update();
    this.teams.forEach((team, t) => {
      let total = 0;
      for (const car of team) {
        car.update(this.world, this.scratch, this.traffic);
        total += this.scoreOf(car);
      }
      if (total > bestScore) {
        best = t;
        bestScore = total;
      }
    });
    // El líder: el mejor coche del mejor equipo (que con un coche por cerebro es el mejor).
    let leader = null;
    let leaderScore = -Infinity;
    for (const car of this.cars) if (!car.damaged && !car.arrived) alive++;
    for (const car of this.teams[best]) {
      const score = this.scoreOf(car);
      if (score > leaderScore) {
        leader = car;
        leaderScore = score;
      }
    }
    this.leader = leader;
    this.mates = this.teams[best];
    this.alive = alive;
    if (this.mode === "together" && this.frame % 12 === 0) this.watchSide();
    if (this.player) this.stepPlayer();
    this.frame++;
    if (alive === 0 || this.frame >= this.maxFrames) this.finishHeat();
  }

  // Modo convivir: de vez en cuando anota por qué lado del eje de la calle va cada
  // coche, mirando en su sentido de marcha. Si la población se pone de acuerdo, el
  // reparto se aleja del 50 %.
  watchSide() {
    for (const car of this.cars) {
      if (car.damaged || car.speed < 1) continue;
      const near = this.world.graph.nearestSegment(car, ROAD_WIDTH);
      if (!near || near.segment.type === "glorieta") continue;
      const off = (car.y - near.point.y) * Math.cos(car.angle) - (car.x - near.point.x) * Math.sin(car.angle);
      if (Math.abs(off) < 6) continue; // sobre el eje: ni un lado ni otro
      this.side.total++;
      if (off > 0) this.side.right++;
    }
  }

  // Cierra la manga actual (también lo usa el botón "Siguiente").
  finishHeat() {
    this.teams.forEach((team, i) => {
      let total = 0;
      let share = 0;
      for (const car of team) {
        const part = this.shareOf(car);
        // En la gira cuenta la proporción cubierta en cada mapa (para que un mapa grande
        // no pese más que uno pequeño), con el mismo desempate de siempre.
        total += this.touring ? part * 1000 - car.idle * 0.001 - (car.damaged ? 0.5 : 0) : this.scoreOf(car);
        share += part;
        this.tally[car.reason || "en pista"]++;
      }
      this.totals[i] += total / team.length;
      this.coverage[i] += share / team.length;
    });
    this.heat++;
    if (this.heat < this.worlds.length) this.startHeat();
    else this.endGeneration();
  }

  // El resultado del mejor de la generación, que es lo que se compara con el récord:
  //   explore   celdas exploradas por su coche
  //   together  celdas exploradas, de media, por los coches de su equipo
  //   goal      % de la ruta recorrido; si llegó, 100 más un extra de 0 a 100 por lo
  //             poco que tardó
  //   en la gira todoterreno, % medio de calle (o de ruta) cubierto en sus mapas
  endGeneration() {
    const order = this.population.map((_, i) => i).sort((a, b) => this.totals[b] - this.totals[a] || a - b);
    // Los 5 mejores de esta generación serán los padres de los cruces.
    this.parents = order.slice(0, 5).map((i) => NeuralNetwork.clone(this.population[i]));
    const best = order[0];
    const team = this.teams[best];
    let fitness;
    if (this.touring) fitness = Math.round((this.coverage[best] / this.worlds.length) * 1000) / 10;
    else if (this.mode === "goal" && this.route) {
      const car = team[0];
      fitness = car.arrived ? 100 + Math.round((1 - car.arrivedAt / this.maxFrames) * 1000) / 10 : Math.round(this.shareOf(car) * 1000) / 10;
    } else fitness = Math.round((team.reduce((sum, car) => sum + car.cells.size, 0) / team.length) * 10) / 10;
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
    this.lastSide = this.side.total ? this.side.right / this.side.total : null;
    const finished = this.generation;
    this.generation++;
    this.spawn();
    if (this.onGeneration) this.onGeneration({ generation: finished, fitness, improved });
  }

  forget() {
    this.adopt();
  }
}
