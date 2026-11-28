"use strict";
// App instalable y sin conexión: registra el service worker (sw.js), avisa cuando hay una
// versión nueva y ofrece instalar la app desde Ajustes.
// Parte de la interfaz (js/app/*.js): comparten el objeto global CN, definido en state.js.

(() => {
  const { $, toast } = CN;

  const web = location.protocol === "https:" || location.protocol === "http:";
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // ---------- Versión nueva ----------
  // El service worker nuevo se instala solo, pero espera a que aceptes recargar para no
  // cambiar el juego a mitad de un entrenamiento.
  let waiting = null;
  let reloading = false;

  function offerUpdate(worker) {
    waiting = worker;
    $("#update").hidden = false;
  }

  $("#update-reload").addEventListener("click", () => {
    if (!waiting) return location.reload();
    reloading = true;
    waiting.postMessage({ type: "skipWaiting" });
  });

  if (web && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) location.reload();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js")
        .then((registration) => {
          // Ya había una versión nueva esperando de una visita anterior.
          if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              // Sin controlador es la primera instalación: no hay nada que recargar.
              if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
            });
          });
        })
        .catch(() => {
          // Sin service worker el juego funciona igual, solo que necesita conexión.
        });
    });
  }

  // ---------- Instalar ----------
  const help = $("#install-help");
  const button = $("#install");
  let prompt = null;

  if (standalone) help.textContent = "Ya la estás usando como app instalada.";
  else if (!web) help.textContent = "Para instalarla y jugar sin conexión, ábrela desde su página web.";
  else if (ios) help.textContent = "En iPhone o iPad: toca Compartir y luego «Añadir a pantalla de inicio».";

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // el navegador no la ofrece solo: se instala con el botón
    prompt = e;
    button.hidden = false;
    help.textContent = "Se abre en su propia ventana y funciona sin conexión.";
  });

  button.addEventListener("click", async () => {
    if (!prompt) return;
    const event = prompt;
    prompt = null;
    button.hidden = true;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome !== "accepted") {
      help.textContent = "Puedes instalarla cuando quieras desde el menú del navegador.";
    }
  });

  window.addEventListener("appinstalled", () => {
    prompt = null;
    button.hidden = true;
    help.textContent = "Instalada: ya puedes abrirla como una app más, también sin conexión.";
    toast("Carreteras Neuronales se instaló como app.");
  });
})();
