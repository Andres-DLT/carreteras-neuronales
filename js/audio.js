"use strict";
// Sonido, todo sintetizado con Web Audio (no hay archivos de audio): el motor del coche
// al que sigue la cámara, la rodadura, un fondo de ciudad, la lluvia, los choques y un
// aviso al batir el récord. El navegador solo deja sonar después de un gesto del
// usuario, así que nada se crea hasta que se activa con el botón.

class Sound {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.lastCrash = 0;
  }

  static get supported() {
    return typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);
  }

  enable(on) {
    this.on = on && Sound.supported;
    if (this.on && !this.ctx) this.build();
    if (!this.ctx) return;
    if (this.on) this.ctx.resume();
    this.master.gain.setTargetAtTime(this.on ? 0.7 : 0, this.ctx.currentTime, 0.05);
  }

  build() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Dos segundos de ruido blanco, que filtrado de distintas formas hace de rodadura,
    // de lluvia, de rumor de ciudad y de chapa en los choques.
    const length = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const hiss = (type, frequency, q) => {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      return gain.gain;
    };
    this.road = hiss("bandpass", 900, 0.6);
    this.rain = hiss("highpass", 2600, 0.5);
    this.city = hiss("lowpass", 240, 0.3);

    // Motor: tres osciladores a distintas octavas tras un filtro que se abre al acelerar.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 400;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    this.engine = engineGain.gain;
    this.voices = [["sawtooth", 1, 0.5], ["square", 0.5, 0.3], ["sawtooth", 1.5, 0.18]].map(([type, ratio, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain).connect(this.engineFilter);
      osc.start();
      return { frequency: osc.frequency, ratio };
    });
    this.engineFilter.connect(engineGain).connect(this.master);
  }

  // speed: de 0 a 1 (velocidad del coche sobre su máxima). throttle: va acelerando.
  // rain: está lloviendo. active: la simulación corre y el coche sigue en pista.
  update({ speed, throttle, rain, active }) {
    if (!this.ctx || !this.on) return;
    const now = this.ctx.currentTime;
    const glide = (param, value, time = 0.08) => param.setTargetAtTime(value, now, time);
    const live = active && !document.hidden;
    const revs = 44 + speed * 96 + (throttle ? 9 : 0);
    for (const voice of this.voices) glide(voice.frequency, revs * voice.ratio);
    glide(this.engineFilter.frequency, 260 + speed * 900 + (throttle ? 260 : 0));
    glide(this.engine, live ? 0.05 + speed * 0.05 + (throttle ? 0.03 : 0) : 0);
    glide(this.road, live ? speed * 0.05 : 0);
    glide(this.city, live ? 0.03 : 0, 0.4);
    glide(this.rain, rain && !document.hidden ? 0.05 : 0, 0.4);
  }

  // Un choque: golpe grave y ruido de chapa que se apaga enseguida.
  crash(strength = 1) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastCrash < 0.15) return;
    this.lastCrash = now;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3200, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5 * strength, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.65);
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(110, now);
    thump.frequency.exponentialRampToValueAtTime(38, now + 0.3);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.6 * strength, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    thump.connect(thumpGain).connect(this.master);
    thump.start(now);
    thump.stop(now + 0.4);
  }

  // Récord batido: tres notas ascendentes.
  record() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx;
    [660, 880, 1320].forEach((frequency, i) => {
      const start = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  }
}
