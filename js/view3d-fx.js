"use strict";
// Efectos de la vista 3D cuando un coche queda eliminado: chispas, humo y marcas de
// frenada que se quedan en el asfalto (con el tiempo, las curvas difíciles acaban
// visiblemente gastadas). Son métodos que se añaden a View3D.

const FX = {
  SPARKS: 700,
  SMOKE: 260,
  SKIDS: 500,
  RANGE: 1300, // más lejos que esto de donde mira la cámara, un choque no suelta chispas
};

// Un montón de partículas que se dibujan como puntos, cada una con su tamaño y su
// transparencia. Las muertas se quedan con tamaño cero.
class Particles {
  constructor(count, map, blending) {
    this.count = count;
    this.next = 0;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.span = new Float32Array(count);
    this.size = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.tint = new Float32Array(count * 4);
    this.alpha = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(count), 1));
    geo.setAttribute("tint", new THREE.BufferAttribute(this.tint, 4));
    this.uniforms = { map: { value: map }, scale: { value: 1 } };
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: `
          attribute float size;
          attribute vec4 tint;
          uniform float scale;
          varying vec4 vTint;
          void main() {
            vTint = tint;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * scale / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D map;
          varying vec4 vTint;
          void main() {
            float a = texture2D(map, gl_PointCoord).a * vTint.a;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vTint.rgb, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, alpha) {
    const i = this.next;
    this.next = (i + 1) % this.count;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.span[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.tint.set([r, g, b, alpha], i * 4);
    this.alpha[i] = alpha;
  }

  // gravity: lo que cae (o sube, si es negativo) en cada paso; drag: lo que se frena.
  step(gravity, drag) {
    const { pos, vel, life, span, size, grow, tint, alpha } = this;
    const sizes = this.points.geometry.getAttribute("size");
    for (let i = 0; i < this.count; i++) {
      if (life[i] <= 0) continue;
      life[i]--;
      const k = i * 3;
      vel[k + 1] -= gravity;
      vel[k] *= drag;
      vel[k + 2] *= drag;
      pos[k] += vel[k];
      pos[k + 1] += vel[k + 1];
      pos[k + 2] += vel[k + 2];
      if (pos[k + 1] < 0.5) {
        pos[k + 1] = 0.5; // rebota en el suelo, perdiendo fuerza
        vel[k + 1] *= -0.35;
      }
      size[i] += grow[i];
      const t = life[i] / span[i];
      tint[i * 4 + 3] = alpha[i] * t;
      sizes.array[i] = life[i] > 0 ? size[i] : 0;
    }
    sizes.needsUpdate = true;
    this.points.geometry.getAttribute("position").needsUpdate = true;
    this.points.geometry.getAttribute("tint").needsUpdate = true;
  }
}

Object.assign(View3D.prototype, {
  makeFx() {
    this.sparks = new Particles(FX.SPARKS, this.tex.pool, THREE.AdditiveBlending);
    this.smoke = new Particles(FX.SMOKE, this.tex.pool, THREE.NormalBlending);
    this.scene.add(this.smoke.points, this.sparks.points);

    // Marcas de frenada: tiras oscuras sobre el asfalto, en un búfer circular.
    const strip = new THREE.PlaneGeometry(1, 1);
    strip.rotateX(-Math.PI / 2);
    this.skids = new THREE.InstancedMesh(
      strip,
      new THREE.MeshBasicMaterial({
        color: 0x0c0c0c, transparent: true, opacity: 0.2, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
      FX.SKIDS
    );
    this.skids.count = 0;
    this.skids.frustumCulled = false;
    this.skids.renderOrder = 1;
    this.scene.add(this.skids);
    this.skidNext = 0;
    this.fxCars = null;
    this.fxSeen = new WeakSet();
    this.fxRng = seededRandom(5);
    this.wrecks = []; // coches recién eliminados que siguen echando humo
  },

  // El mapa cambió: las marcas de frenada eran de otras calles.
  clearFx() {
    if (!this.skids) return;
    this.skids.count = 0;
    this.skidNext = 0;
    this.wrecks = [];
  },

  // Chispas, una nube de humo y dos marcas de frenada donde un coche acaba de chocar.
  burst(car) {
    const rng = this.fxRng;
    const h = this.heightOf(car);
    const fx = Math.cos(car.angle), fz = Math.sin(car.angle);
    const x = car.x + fx * 18, z = car.y + fz * 18;
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      const force = 0.8 + rng() * 2.6;
      this.sparks.emit(
        x, h + 5 + rng() * 5, z,
        Math.cos(a) * force - fx * 0.8, 1 + rng() * 2.6, Math.sin(a) * force - fz * 0.8,
        16 + rng() * 22, 3 + rng() * 2.5, -0.05, 1, 0.55 + rng() * 0.35, 0.18, 1
      );
    }
    for (let i = 0; i < 4; i++) {
      this.smoke.emit(
        x + (rng() - 0.5) * 10, h + 7, z + (rng() - 0.5) * 10,
        (rng() - 0.5) * 0.3, 0.35 + rng() * 0.25, (rng() - 0.5) * 0.3,
        60 + rng() * 40, 14, 0.42, 0.34, 0.34, 0.35, 0.5
      );
    }
    if (!car.level) {
      const d = this.dummy;
      const length = 38 + rng() * 44;
      for (const side of [-1, 1]) {
        d.position.set(car.x - fx * (length / 2 + 6) - fz * side * 9, V3.Y_MARK + 0.2, car.y - fz * (length / 2 + 6) + fx * side * 9);
        d.rotation.set(0, -car.angle, 0);
        d.scale.set(length, 1, 2.2);
        d.updateMatrix();
        this.skids.setMatrixAt(this.skidNext, d.matrix);
        this.skidNext = (this.skidNext + 1) % FX.SKIDS;
        this.skids.count = Math.min(FX.SKIDS, this.skids.count + 1);
      }
      this.skids.instanceMatrix.needsUpdate = true;
    }
  },

  updateFx(sim, state) {
    if (!this.sparks) return;
    const scale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.sparks.uniforms.scale.value = this.smoke.uniforms.scale.value = scale;
    if (!state.steps) return; // en pausa, todo se queda quieto

    if (this.fxCars !== sim.cars) {
      this.fxCars = sim.cars;
      this.fxSeen = new WeakSet();
    }
    let budget = 5; // como mucho, tantos estallidos por fotograma
    const check = (car) => {
      if (!car.damaged || this.fxSeen.has(car)) return;
      this.fxSeen.add(car);
      if (car.reason === "atascado") return;
      const near = Math.hypot(car.x - this.camTarget.x, car.y - this.camTarget.z) < FX.RANGE;
      if (near && budget-- > 0) {
        this.burst(car);
        if (car === state.subject) this.wrecks.push({ car, until: this.frame + 150 });
      }
    };
    for (const car of sim.cars) check(car);
    if (sim.player) check(sim.player);

    // El coche al que seguía la cámara echa humo un rato después de chocar.
    this.wrecks = this.wrecks.filter((w) => w.until > this.frame);
    if (this.frame % 5 === 0) {
      const rng = this.fxRng;
      for (const { car } of this.wrecks) {
        this.smoke.emit(
          car.x + Math.cos(car.angle) * 14, this.heightOf(car) + 9, car.y + Math.sin(car.angle) * 14,
          (rng() - 0.5) * 0.25, 0.4 + rng() * 0.25, (rng() - 0.5) * 0.25,
          70 + rng() * 40, 10, 0.38, 0.28, 0.28, 0.29, 0.45
        );
      }
    }
    this.sparks.step(0.14, 0.97);
    this.smoke.step(-0.004, 0.985);
  },
});
