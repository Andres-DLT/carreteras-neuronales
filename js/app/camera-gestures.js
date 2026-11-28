"use strict";
// Cámara y gestos: tamaño del lienzo, zoom, encuadre, tocar, arrastrar, desplazar y pellizcar; herramientas del editor.
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

(() => {
  const {
    $, app, canvas, DRIVE_ZOOM, HIT_RADIUS, mapEdited, narrow, persistSoon, SEGMENT_HIT, stage,
    syncControls, toast, ui, view
  } = CN;

  // Las funciones se elevan: se comparten desde el principio.
  Object.assign(CN, {
    fitView, resize, setFollow,
  });

  // ---------- Cámara ----------
  function resize() {
    CN.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * CN.dpr);
    canvas.height = Math.round(canvas.clientHeight * CN.dpr);
    if (CN.view3d) CN.view3d.resize(canvas.clientWidth, canvas.clientHeight, CN.dpr);
    CN.lastSparkLength = -1;
    CN.chartsDirty = true;
  }
  new ResizeObserver(resize).observe(canvas);

  const screenPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p) => ({
    x: (p.x - canvas.clientWidth / 2) / view.zoom + view.x,
    y: (p.y - canvas.clientHeight / 2) / view.zoom + view.y,
  });

  function zoomAt(p, factor) {
    const before = toWorld(p);
    view.zoom = clamp(view.zoom * factor, 0.12, 3);
    const after = toWorld(p);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
  }

  // Encaja el mapa en el hueco que dejan libre la barra superior y la consola.
  function fitView() {
    const points = stage().graph.points;
    if (!points.length) {
      view.x = 0;
      view.y = 0;
      view.zoom = 0.6;
      return;
    }
    const box = boundsOf(points);
    const appBox = app.getBoundingClientRect();
    let top = $(".bar").getBoundingClientRect().bottom - appBox.top + 8;
    const side = $(".side");
    if (narrow && ui.mode === "train" && side.offsetParent) top = side.getBoundingClientRect().bottom - appBox.top + 8;
    const dock = $(".dock").getBoundingClientRect();
    const bottom = appBox.bottom - dock.top + 8;
    const sideWidth = !narrow && ui.mode === "train" ? 290 : 0;
    const w = canvas.clientWidth - sideWidth;
    const h = Math.max(120, canvas.clientHeight - top - bottom);
    const pad = ROAD_WIDTH;
    view.zoom = clamp(Math.min(w / (box.maxX - box.minX + pad * 2), h / (box.maxY - box.minY + pad * 2)), 0.12, 1.4);
    view.x = (box.minX + box.maxX) / 2 + sideWidth / 2 / view.zoom;
    view.y = (box.minY + box.maxY) / 2 - (top - bottom) / 2 / view.zoom;
  }

  function setFollow(on) {
    ui.follow = on;
    if (on) view.zoom = DRIVE_ZOOM;
    else fitView();
    syncControls();
    persistSoon();
  }

  // ---------- Gestos: tocar, arrastrar, desplazar, pellizcar ----------
  const pointers = new Map();
  CN.gesture = null;

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, span: Math.max(distance(a, b), 1) };
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const pos = screenPos(e);
    pointers.set(e.pointerId, pos);
    if (pointers.size === 2) {
      CN.gesture = { type: "pinch", ...pinchInfo() };
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 2) {
      ui.selected = null;
      syncControls();
      return;
    }
    const at = toWorld(pos);
    const hit = ui.mode === "edit" && ui.tool === "add" ? CN.world.graph.nearestPoint(at, HIT_RADIUS / view.zoom) : null;
    CN.gesture = { type: e.button === 1 ? "pan" : "tap", origin: pos, last: pos, at, hit };
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = screenPos(e);
    if (e.pointerType === "mouse") {
      ui.pointer = toWorld(pos);
      ui.hover = ui.mode === "edit" ? CN.world.graph.nearestPoint(ui.pointer, HIT_RADIUS / view.zoom) : null;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, pos);
    if (!CN.gesture) return;

    if (CN.gesture.type === "pinch") {
      if (pointers.size < 2) return;
      const info = pinchInfo();
      zoomAt(info.mid, info.span / CN.gesture.span);
      if (!ui.follow || ui.mode === "edit") {
        view.x -= (info.mid.x - CN.gesture.mid.x) / view.zoom;
        view.y -= (info.mid.y - CN.gesture.mid.y) / view.zoom;
      }
      Object.assign(CN.gesture, info);
      return;
    }
    if (CN.gesture.type === "tap" && distance(pos, CN.gesture.origin) > 6) {
      CN.gesture.type = CN.gesture.hit ? "drag" : "pan";
      if (CN.gesture.type === "pan" && ui.mode === "train" && ui.follow) {
        ui.follow = false;
        syncControls();
      }
    }
    if (CN.gesture.type === "drag") {
      const w = toWorld(pos);
      CN.gesture.hit.x = w.x;
      CN.gesture.hit.y = w.y;
      mapEdited();
    } else if (CN.gesture.type === "pan") {
      view.x -= (pos.x - CN.gesture.last.x) / view.zoom;
      view.y -= (pos.y - CN.gesture.last.y) / view.zoom;
    }
    CN.gesture.last = pos;
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (CN.gesture && CN.gesture.type === "pinch") {
      if (pointers.size === 1) {
        const [p] = pointers.values();
        CN.gesture = { type: "pan", origin: p, last: p };
      } else CN.gesture = null;
      return;
    }
    if (CN.gesture && CN.gesture.type === "tap" && e.type === "pointerup") handleTap(CN.gesture.at, CN.gesture.hit);
    const wasDrag = CN.gesture && CN.gesture.type === "drag";
    CN.gesture = null;
    if (wasDrag) ui.needsBuild = true; // ahora sí, recoloca edificios y árboles
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") {
      ui.pointer = null;
      ui.hover = null;
    }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(screenPos(e), Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false }
  );

  function handleTap(at, hit) {
    if (ui.mode !== "edit") return;
    const g = CN.world.graph;
    if (ui.tool === "add") {
      if (hit) {
        const connected = hit !== ui.selected && ui.selected && g.addSegment(ui.selected, hit);
        ui.selected = hit === ui.selected ? null : hit;
        if (connected) mapEdited();
        else syncControls();
      } else {
        const near = g.nearestSegment(at, SEGMENT_HIT / view.zoom);
        const p = near ? g.splitSegment(near.segment, near.point) : g.addPoint({ x: at.x, y: at.y });
        if (ui.selected) g.addSegment(ui.selected, p);
        ui.selected = p;
        mapEdited();
      }
    } else if (ui.tool === "erase") {
      const p = g.nearestPoint(at, HIT_RADIUS / view.zoom);
      if (p) {
        g.removePoint(p);
        if (ui.selected === p) ui.selected = null;
        mapEdited();
        return;
      }
      const near = g.nearestSegment(at, ROAD_WIDTH / 2);
      if (near) {
        g.removeSegment(near.segment);
        g.removeOrphans(ui.selected);
        mapEdited();
      }
    } else if (ui.tool === "start") {
      if (distance(at, CN.world.start) < 30) {
        CN.world.start.angle += Math.PI;
        mapEdited();
        return;
      }
      const near = g.nearestSegment(at, ROAD_WIDTH / 2);
      if (!near) {
        toast("Toca sobre una carretera para poner la salida.");
        return;
      }
      if (near.segment.type === "puente") {
        toast("La salida tiene que estar a ras de suelo, no sobre un puente.");
        return;
      }
      const { a, b } = near.segment;
      CN.world.start = { x: near.point.x, y: near.point.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
      mapEdited();
    } else if (ui.tool === "type") {
      const near = g.nearestSegment(at, ROAD_WIDTH / 2);
      if (!near) {
        toast("Toca sobre un tramo para cambiar su tipo.");
        return;
      }
      toast(cycleRoadType(near.segment));
      mapEdited();
    } else if (ui.tool === "goal") {
      if (CN.world.goal && distance(at, CN.world.goal) < 45) {
        CN.world.goal = null;
        toast("Destino quitado: los coches irán al punto más lejano de la salida.");
        mapEdited();
        return;
      }
      const near = g.nearestSegment(at, ROAD_WIDTH / 2);
      if (!near) {
        toast("Toca sobre una calle para poner el destino.");
        return;
      }
      CN.world.goal = { x: Math.round(near.point.x), y: Math.round(near.point.y) };
      toast(ui.learn === "goal" ? "Destino puesto." : "Destino puesto. Elige «Ir a un destino» en Ajustes para entrenar con él.");
      mapEdited();
    }
  }

  // Siguiente tipo para un tramo. El sentido único pasa dos veces: primero en el
  // sentido en que se dibujó el tramo y luego al revés (intercambiando sus extremos).
  function cycleRoadType(s) {
    const len = distance(s.a, s.b);
    const canBridge = len >= RAMP_LENGTH * 2 + 80;
    if (s.type === "avenida") {
      s.type = "unico";
      s.flipped = false;
      return "Sentido único: los coches circulan en el sentido de las flechas.";
    }
    if (s.type === "unico" && !s.flipped) {
      [s.a, s.b] = [s.b, s.a];
      s.flipped = true;
      return "Sentido único, ahora en el sentido contrario.";
    }
    if (s.type === "unico") {
      if (canBridge) {
        s.type = "puente";
        return "Puente: pasa por encima de las calles que cruza.";
      }
      s.type = "normal";
      return "Calle normal (este tramo es demasiado corto para ser puente).";
    }
    if (s.type === "normal" || !s.type) {
      s.type = "avenida";
      return "Avenida: cuatro carriles, dos por sentido.";
    }
    s.type = "normal"; // puente o glorieta
    return "Calle normal de doble sentido.";
  }
})();
