"use strict";
// Modelos de coche de la vista 3D. Cuatro carrocerías con la misma planta que el coche
// de la simulación (48 × 26 unidades, ≈ 4.5 × 2.4 m): sedán, compacto, todoterreno y
// furgoneta. Cada una se entrega en piezas según cómo se pinta:
//   paint  lo que lleva el color del coche (carrocería, techo, retrovisores)
//   trim   cristales, parachoques, parrilla, pasos de rueda y matrículas
//   head   faros      tail   pilotos traseros (se encienden al frenar)
// Las ruedas van aparte (kit.wheel) porque giran y, las de delante, también tuercen.
// Todo mira hacia +x. Solo se llama con three.js ya cargado.

const CAR_STYLES = ["sedan", "hatch", "suv", "van"];

function buildCarKit() {
  const W = CAR_WIDTH;
  const shape = (points) => {
    const s = new THREE.Shape();
    points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    s.closePath();
    return s;
  };
  // Perfil lateral (x hacia delante, y hacia arriba) estirado a lo ancho, con los cantos romos.
  const extrude = (points, width, bevel) => {
    const geo = new THREE.ExtrudeGeometry(shape(points), {
      depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, steps: 1,
    });
    geo.translate(0, 0, -(width - bevel * 2) / 2);
    return geo;
  };
  const box = (sx, sy, sz, x, y, z) => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    geo.translate(x, y, z);
    return geo;
  };
  const disc = (radius, thick, x, y, z) => {
    const geo = new THREE.CylinderGeometry(radius, radius, thick, 20);
    geo.rotateX(Math.PI / 2);
    geo.translate(x, y, z);
    return geo;
  };

  const GLASS = "#141d26";
  const PLASTIC = "#24272a";
  const PLATE = "#e6e6de";
  const AXLE = 15.2; // de cada eje al centro del coche

  // lift: cuánto más alta va la carrocería; wheel: radio de la rueda.
  const specs = {
    sedan: {
      wheel: 4.5,
      body: [[-23.2, 4.6], [-23.4, 7.6], [-22.6, 9.3], [-20.5, 10.2], [-12.5, 10.5], [8.5, 10.2], [17, 9.4], [21.8, 8.2], [23.3, 6.6], [23.4, 4.4], [22.4, 3.1], [-22.2, 3.1]],
      cabin: [[-16.5, 10.2], [-11, 15], [-9.5, 15.3], [2.2, 15.4], [3.6, 15.1], [10.8, 10.1]],
      roof: [-10.4, 3, 15.35], pillar: [-3.4, 10.2, 15.3], mirror: [7.4, 10.9], head: 7.5, tail: [8.3, 2, 5.6, 8.4],
    },
    hatch: {
      wheel: 4.5,
      body: [[-22.6, 4.6], [-22.9, 8.6], [-22, 10.6], [-18, 10.9], [8.5, 10.2], [16.6, 9.4], [21.6, 8.2], [23.2, 6.6], [23.4, 4.4], [22.4, 3.1], [-21.8, 3.1]],
      cabin: [[-21.4, 10.8], [-17.2, 15.2], [-15.6, 15.5], [2, 15.6], [3.4, 15.3], [10.6, 10.2]],
      roof: [-16.4, 2.8, 15.55], pillar: [-5, 10.6, 15.5], mirror: [7.2, 10.9], head: 7.5, tail: [9.4, 2.2, 4.6, 8.8],
    },
    suv: {
      wheel: 5.3,
      body: [[-23.2, 5.8], [-23.4, 10.2], [-22.4, 12.4], [-19.5, 12.8], [9, 12.5], [18, 11.6], [22.2, 10.2], [23.3, 8.2], [23.4, 5.6], [22.4, 4.4], [-22.2, 4.4]],
      cabin: [[-21.8, 12.7], [-18.6, 18.4], [-17, 18.7], [3, 18.8], [4.4, 18.5], [11.2, 12.5]],
      roof: [-17.8, 3.8, 18.75], pillar: [-5, 12.6, 18.7], mirror: [8, 13.3], head: 9.4, tail: [10.8, 2.4, 4.8, 8.8], rails: 19.7,
    },
    van: {
      wheel: 4.7,
      body: [[-23.4, 4.6], [-23.5, 19.4], [-22.6, 20.6], [9, 20.6], [12.8, 20], [20.4, 12.8], [22.9, 10.6], [23.4, 6.2], [23.4, 4.4], [22.4, 3.1], [-22.4, 3.1]],
      mirror: [13.5, 12.6], head: 8.2, tail: [11.5, 6, 2.2, 10.6],
    },
  };

  const kit = {};
  for (const [name, s] of Object.entries(specs)) {
    const paint = [{ geo: extrude(s.body, W, 1.4) }];
    const trim = [];
    if (s.cabin) {
      trim.push({ geo: extrude(s.cabin, W - 5, 0.8), color: GLASS });
      paint.push({ geo: box(s.roof[1] - s.roof[0], 0.9, W - 6.4, (s.roof[0] + s.roof[1]) / 2, s.roof[2], 0) });
      for (const z of [-1, 1]) {
        paint.push({ geo: box(1.7, s.pillar[2] - s.pillar[1], 0.6, s.pillar[0], (s.pillar[1] + s.pillar[2]) / 2, z * (W / 2 - 2.35)) });
      }
    } else {
      // Furgoneta: parabrisas sobre el frente inclinado y una ventanilla en cada puerta.
      const glass = new THREE.BoxGeometry(10.8, 0.5, W - 4.4);
      glass.rotateZ(-Math.atan2(7.2, 7.6));
      glass.translate(16.9, 16.75, 0);
      trim.push({ geo: glass, color: GLASS });
      for (const z of [-1, 1]) trim.push({ geo: box(8.6, 5.4, 0.5, 8, 16.4, z * (W / 2 + 0.05)), color: GLASS });
    }
    if (s.rails) {
      for (const z of [-1, 1]) trim.push({ geo: box(17, 0.8, 0.9, -7, s.rails, z * (W / 2 - 4.6)), color: PLASTIC });
    }
    for (const z of [-1, 1]) paint.push({ geo: box(1.7, 1.4, 2, s.mirror[0], s.mirror[1], z * (W / 2 + 0.8)) });
    const low = s.wheel - 0.1;
    trim.push({ geo: box(1.5, 2.8, W - 1.2, 23.3, low + 0.2, 0), color: PLASTIC }); // parachoques
    trim.push({ geo: box(1.5, 2.8, W - 1.2, -23.3, low + 0.2, 0), color: PLASTIC });
    trim.push({ geo: box(0.6, 2.2, 9.6, 23.75, s.head, 0), color: PLASTIC }); // parrilla
    trim.push({ geo: box(0.4, 1.9, 6.2, 24.1, low + 0.2, 0), color: PLATE });
    trim.push({ geo: box(0.4, 1.9, 6.2, -24.1, low + 0.2, 0), color: PLATE });
    for (const x of [-AXLE, AXLE]) {
      for (const z of [-1, 1]) trim.push({ geo: disc(s.wheel + 1.2, 0.9, x, s.wheel, z * (W / 2 - 0.2)), color: "#0d0e0f" }); // paso de rueda
    }
    const head = [];
    const tail = [];
    for (const z of [-1, 1]) {
      head.push({ geo: box(0.8, 2.3, 5.4, 23.6, s.head, z * 8.3) });
      tail.push({ geo: box(0.8, s.tail[1], s.tail[2], -23.6, s.tail[0], z * s.tail[3]) });
    }
    kit[name] = {
      wheel: s.wheel,
      paint: mergeGeometries(paint),
      trim: mergeGeometries(trim),
      head: mergeGeometries(head),
      tail: mergeGeometries(tail),
    };
  }

  // Rueda de radio 1 (cada carrocería la escala a su medida): neumático, llanta y cinco radios.
  const wheel = [{ geo: disc(1, 0.8, 0, 0, 0), color: "#131313" }, { geo: disc(0.58, 0.84, 0, 0, 0), color: "#a9aeb2" }];
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.BoxGeometry(0.16, 0.56, 0.86);
    spoke.translate(0, 0.3, 0);
    spoke.rotateZ((i / 5) * Math.PI * 2);
    wheel.push({ geo: spoke, color: "#62676b" });
  }
  kit.wheel = mergeGeometries(wheel);
  kit.axle = AXLE;
  kit.track = W / 2 - 1.5; // del centro del coche al centro de cada rueda
  return kit;
}
