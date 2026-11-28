# Carreteras Neuronales

Un mundo virtual en JavaScript donde dibujas carreteras y una población de coches
autónomos aprende a conducir por ellas mediante una red neuronal y un algoritmo
genético. La ciudad tiene tráfico, semáforos, peatones, edificios y árboles, y se
puede ver en plano o en una vista 3D realista.

La simulación, el editor y la vista en plano son JavaScript puro, sin librerías. Solo
la vista 3D usa [three.js](https://threejs.org), que va incluido en `vendor/` y se
carga la primera vez que se pide.

**▶ Juega aquí: https://andres-dlt.github.io/carreteras-neuronales/**

## Cómo abrirlo

Los scripts son clásicos (no módulos), así que basta con abrir `index.html` en el
navegador. Si prefieres un servidor local:

```bash
py -m http.server 8765
```

y abre http://localhost:8765 (con Node: `npm run serve`).

## Instalar y jugar sin conexión

Desde la página web se puede instalar como una app, con su ícono, y después funciona
sin conexión: la primera visita guarda el juego entero (scripts, fuentes, íconos y
three.js) en el navegador.

- **Chrome o Edge (ordenador o Android)**: *Ajustes* → **Instalar la app**, o el menú
  del navegador → *Instalar*.
- **iPhone o iPad (Safari)**: botón *Compartir* → **Añadir a pantalla de inicio**.

Cuando se publica una versión nueva, se descarga sola y aparece el aviso **Nueva versión
disponible**; al tocar *Recargar* se usa la nueva. Abriendo `index.html` desde el disco
también se juega sin conexión, pero así no se puede instalar.

## Pruebas

```bash
npm ci
npm test                              # simulación en Node: geometría, grafo, red, mapas y determinismo
npx playwright install chromium
npm run e2e                           # humo de la interfaz en escritorio y móvil, también por file://
```

GitHub Actions corre las dos en cada push y en cada pull request. En cada push a `main`,
si pasan, publica el juego en GitHub Pages: sin las pruebas ni los scripts, y con el
commit como versión del service worker.

## Cómo se usa

- **Editar mapa**: toca para poner puntos; cada uno se une al anterior. Toca un punto
  existente para conectarlo (o el último otra vez para terminar el tramo). Tocar sobre
  una carretera la parte en dos y crea un cruce. Arrastra puntos para moverlos y el
  fondo para desplazarte; rueda o pellizco para el zoom. La herramienta *Salida*
  coloca la línea de salida (tócala otra vez para invertir el sentido).
- **Tipo** (herramienta del editor): toca un tramo para cambiarlo entre calle,
  avenida (cuatro carriles), sentido único (en un sentido o en el otro) y puente.
- **Mis mapas**: guarda el mapa actual con un nombre, ábrelo o bórralo después, o
  empieza desde las plantillas *Circuito*, *Cuadrícula*, *Glorieta*, *Montaña* y
  *Ciudad grande*. **Ciudad al azar** genera una ciudad distinta cada vez: calles
  torcidas y dobladas, y según la suerte una avenida, calles de sentido único, una
  glorieta y un puente. **Barrios reales**: calles de verdad sacadas de OpenStreetMap
  (ver más abajo).
- **Qué aprenden** (en *Ajustes*): cada modo guarda su propio entrenamiento.
  - *Explorar*, el de siempre: gana quien más terreno distinto recorre.
  - *Ir a un destino*: gana quien más avanza por la ruta más corta hasta el destino
    y, si llegan varios, quien llega antes. El destino se pone con la herramienta
    **Destino** del editor (sin él, van al punto más lejano de la salida) y la ruta
    se ve punteada en el mapa. El cerebro recibe dos entradas más, que le dicen hacia
    dónde sigue la ruta, así que usa una red aparte (11 → 8 → 4).
  - *Convivir*: cada cerebro conduce un equipo de 6 coches repartidos por el mapa,
    la mitad en sentido contrario, que pueden chocar entre sí y no tienen más tráfico.
    Puntúa la media del equipo, así que solo prosperan las formas de conducir que
    conviven consigo mismas. El marcador dice qué parte circula por la derecha: si se
    aleja del 50 %, la población se ha inventado una norma.
- **Entrenamiento todoterreno** (en *Ajustes*): cada generación corre una manga en tu
  mapa, otra en una ciudad al azar fija y otra en cada barrio real de la gira, con los
  mismos cerebros. Gana quien explora más proporción de calle sumando todas las mangas,
  así el cerebro aprende a conducir en general y no a recorrer un mapa concreto. El
  récord pasa a ser el % medio de calle explorada. **Exportar mapa** descarga un
  archivo `.json` con el mapa y su cerebro entrenado; **Importar mapa** lo carga en
  otro navegador o dispositivo.
- **Entrenar**: todos los coches salen a la vez. Cuando chocan todos (o pasa un minuto
  simulado), el que más terreno exploró pasa su cerebro a la siguiente generación.
  En *Ajustes* se elige cuánto tráfico hay (0–30 coches) y si hay semáforos y peatones.
- **Turbo**: entrena sin dibujar en un hilo aparte (Web Worker), decenas de veces más
  rápido que ×8 y sin congelar la página. Al pulsar *Detener turbo* los coches vuelven a
  la pista con el cerebro que se haya logrado. Si el navegador no permite Workers (por
  ejemplo al abrir `index.html` directamente desde el disco), el turbo corre en la propia
  pestaña a ratos cortos.
- **Cerebro por mapa**: cada mapa guarda su mejor cerebro. Al volver a un mapa ya
  entrenado se recupera su récord y su generación; en un mapa nuevo los coches parten
  de lo aprendido en el anterior.
- **Por qué se eliminan**: gráfica de barras con el porcentaje de coches de cada
  generación que acabó por choque, por pasarse un rojo, por atropello, por quedarse
  atascado o que seguía en pista al terminar.
- **3D**: el botón bajo la escala cambia a la vista 3D realista (entrenando): cámara en
  perspectiva detrás del líder, o desde lo alto si no lo sigues, con sombras, casas con
  tejado y ventanas, árboles, farolas, semáforos con poste, coches con volumen y puentes
  elevados. Con el tema claro es de día; con el oscuro es de noche, con las ventanas y
  las farolas encendidas y los faros alumbrando la calle. La rueda o el pellizco acercan
  y alejan la cámara. En el editor, y en navegadores sin WebGL, el botón levanta los
  edificios en perspectiva aérea sobre el plano, como antes.
- **Cámara** (en 3D): *detrás* del coche, *conductor* (desde el capó), *dron* (dando
  vueltas a su alrededor) y *director*, que cambia sola de plano y pone unos segundos de
  cámara lenta cuando se bate el récord.
- **Hora del día y clima** (en *Ajustes*, para el 3D): día, atardecer con sombras
  largas o noche, y despejado, lluvia (con el asfalto mojado reflejando el cielo y las
  luces) o niebla.
- **Barrios con su aspecto**: en 3D cada barrio real se viste a su estilo. Torres de
  cristal y un rascacielos en Midtown, manzanas de piedra con patio en el Eixample,
  tejados de zinc y el Arco del Triunfo en L'Étoile, fachadas de colores y la plaza con
  su bandera en el Centro Histórico, y casas bajas con un parque en la Condesa. En las
  aceras hay árboles, bancos, papeleras, buzones, paradas de autobús y gente paseando.
- **Conducir**: llevas tú un coche con las flechas o WASD (en pantallas táctiles, con
  los botones que aparecen) por el mismo mapa y con las mismas reglas: chocar, pasarte
  un rojo o atropellar te devuelve a la salida. El marcador muestra lo que llevas
  recorrido junto a lo del líder. No cuenta para el entrenamiento.
- **Sonido**: motor, rodadura, lluvia, choques y un aviso al batir el récord. Todo está
  sintetizado en el navegador; no hay archivos de audio.
- **Choques** (en 3D): chispas y humo donde un coche queda eliminado, y marcas de
  frenada que se quedan en el asfalto, así las curvas difíciles acaban gastadas.
- **Estelas de luz** (en *Ajustes*): cada coche deja un trazo de luz, como en una foto
  de larga exposición. La calle brilla más por donde pasa más población (de azul a
  blanco), queda un destello donde un coche se elimina y el recorrido del líder se
  marca en ámbar. Al empezar otra generación lo anterior se atenúa, así se ve cómo
  cambia el recorrido de una generación a otra. Con el turbo no se dibujan.

## La ciudad

- **Tipos de calle**: las avenidas miden 160 unidades (unos 15 m) y tienen dos
  carriles por sentido con doble línea central; las calles de sentido único llevan
  flechas y el tráfico solo las recorre en ese sentido; las glorietas giran en sentido
  antihorario y no tienen semáforos.
- **Puentes**: van en un nivel aparte. Cruzan por encima de otras calles sin formar
  cruce; un coche sube al entrar por un extremo en la dirección del puente y, mientras
  está arriba, solo choca con las barandillas y con el tráfico que también va por el puente.
- **Semáforos** en cada cruce de 3 o más calles. Los accesos opuestos comparten fase:
  6 s de verde, 1.5 s de ámbar y rojo mientras tanto. Pasarse un rojo elimina al coche.
- **Tráfico**: coches que circulan por su carril, frenan ante el rojo y ante el coche
  de delante, y en cada cruce eligen una salida. Chocar con ellos elimina al coche.
- **Peatones** en pasos de cebra: en los cruces atraviesan mientras su acceso está en
  rojo, y en mitad de las calles largas cruza alguien cada 12 s. Atropellar elimina al
  coche; el tráfico les cede el paso.
- **Edificios y árboles** generados a partir del propio mapa, así el mismo mapa siempre
  luce igual. De noche (tema oscuro) la ciudad se ilumina con la línea central ámbar.

Todo es determinista dentro de una generación (misma semilla y mismos tiempos), así el
mejor cerebro repite exactamente su resultado y el récord nunca retrocede.

## Barrios reales

Las calles de los barrios reales vienen de **OpenStreetMap**
(© [colaboradores de OpenStreetMap](https://www.openstreetmap.org/copyright), licencia ODbL).
Para cada barrio se descargaron las calles por las que pueden circular coches en un
cuadrado de unos 460–600 m de lado y se convirtieron al formato del juego, a escala real:

- `oneway` → sentido único, `junction=roundabout` → glorieta, `bridge` → puente
  (si es largo y recto) y vía principal de 3 o más carriles → avenida.
- Se simplifican los trazados, se unen los nodos casi duplicados, se quitan los
  callejones sin salida y se añade una circunvalación por el borde del recorte para
  que las calles que salen del barrio no terminen en un muro.
- Las calles peatonales no aparecen (por eso el Centro Histórico tiene menos calles
  de las que se ven en un mapa normal).

Los datos ya convertidos están en `js/real-maps.js`: el juego no se conecta a internet.

## Cómo funciona

| Archivo | Qué hace |
|---|---|
| `js/math.js` | Intersección de segmentos, punto en polígono, proyecciones. |
| `js/graph.js` | El grafo del mapa: puntos y tramos con su tipo (calle, avenida, sentido único, glorieta, puente). |
| `js/world.js` | Ruta más corta hasta el destino y salidas repartidas del modo convivir. Convierte cada tramo en un polígono redondeado y calcula la unión de todos para obtener los bordes; puentes en un nivel aparte; marcas viales de cada tipo; rejilla espacial. |
| `js/maps.js` | Plantillas de mapa y generador de ciudades al azar con semilla. |
| `js/real-maps.js` | Barrios reales convertidos de OpenStreetMap. |
| `js/network.js` | Red neuronal de propagación hacia delante (9 → 6 → 4) con activación escalón, mutación y cruce. |
| `js/car.js` | Física del coche, 7 sensores en abanico, choques y medición del terreno explorado. |
| `js/traffic.js` | Cruces, ciclo de los semáforos, pasos de cebra, peatones, coches de tráfico y obstáculos móviles. |
| `js/scenery.js` | Edificios a lo largo de las calles y arbolado en los huecos libres, en plano y en 3D. |
| `js/trails.js` | Estelas de luz: los trazos de los coches se acumulan en un lienzo aparte y se atenúan en cada generación. |
| `js/view3d-geometry.js` | Medidas de la escena 3D, altura de los puentes y ayudas para construir mallas a mano y unir geometrías. |
| `js/view3d.js` | Vista 3D realista: construye la escena de cada mapa (calles, aceras, marcas viales, casas, árboles, farolas, semáforos, puentes) y mueve en ella coches, peatones, sensores, estelas y cámara. |
| `js/view3d-cars.js` | Modelos de coche del 3D: sedán, compacto, todoterreno y furgoneta, con las ruedas aparte para que giren. |
| `js/view3d-fx.js` | Chispas, humo y marcas de frenada de los choques en 3D. |
| `js/view3d-city.js` | Estilo de edificación y monumento de cada barrio real, mobiliario de las aceras y gente paseando. |
| `js/audio.js` | Sonido sintetizado con Web Audio: motor, rodadura, lluvia, choques y aviso de récord. |
| `vendor/three.min.js` | [three.js](https://threejs.org) r159 (licencia MIT), el motor con el que se dibuja la vista 3D. |
| `js/worker.js` | Entrenamiento turbo: la misma simulación en un Web Worker, avisando al final de cada generación. |
| `js/sim.js` | Los tres modos de aprendizaje y el coche que conduces tú (fuera de la población). Generaciones: elitismo (el mejor pasa intacto), mutantes del mejor con intensidad escalonada, hijos de cruzar a los 5 mejores, un 10 % de cerebros nuevos y más exploración si el récord se estanca. Con la gira todoterreno, una manga por mapa. |
| `js/app/state.js` | Interfaz, estado compartido: referencias al DOM, colores del tema, el mundo y la simulación, arranque y avisos. Define el objeto global `CN` con el que se comunican los scripts de `js/app/`. |
| `js/app/training.js` | Gira todoterreno, qué aprenden, cerebro guardado por mapa, modos editar/entrenar y turbo. |
| `js/app/draw.js` | Dibujo del plano (calles, pasos de cebra, semáforos, coches y sensores) y paso a la vista 3D. |
| `js/app/panels.js` | Visualizador de la red, cifras, gráfica de bajas y los controles del panel. |
| `js/app/camera-gestures.js` | Cámara, zoom y gestos: tocar, arrastrar, desplazar y pellizcar; herramientas del editor. |
| `js/app/drive.js` | Conducir tú: teclado y botones táctiles. |
| `js/app/maps-panel.js` | Mis mapas: guardar, abrir, exportar, importar, plantillas y barrios reales. |
| `js/app/pwa.js` | App instalable: registra el service worker, avisa de las versiones nuevas y ofrece instalarla. |
| `js/app/main.js` | Bucle principal: simula y dibuja cada fotograma; arranca la interfaz. |
| `sw.js` | Service worker: guarda el juego al instalarse y responde desde la caché, actualizándola en segundo plano. |
| `manifest.webmanifest`, `icons/` | Nombre, colores e íconos de la app instalada. `scripts/make-icons.mjs` genera los PNG a partir de `icons/icon.svg`. |
| `fonts/` | Overpass y Overpass Mono (de @fontsource, licencia SIL OFL 1.1), incluidas para no depender de Google Fonts. |

**Entradas de la red**: las 7 distancias de los sensores, más la cercanía de un
semáforo en rojo y la de un obstáculo (otro coche o un peatón). Sin esas dos, un rojo se vería igual que la pared
de una curva, y ante una pared hay que girar mientras que ante el rojo hay que frenar.

**Aptitud**: la superficie distinta que pisa cada coche (celdas de 3.75 m). Dar
vueltas en el mismo sitio no suma, y un coche que pasa 2.5 s sin pisar terreno nuevo
se retira, salvo si está esperando ante un rojo o detrás de otro coche.

**Escala**: un coche mide 48 unidades, que equivalen a 4.5 m; la carretera mide unos
9.4 m de ancho, la velocidad máxima ronda los 65 km/h y el tráfico va a unos 40 km/h.

El mapa activo, los mapas guardados, el mejor cerebro y el récord se guardan en el
navegador (`localStorage`).

## Si te interesa el tema

Radu Mariescu-Istodor tiene dos cursos gratuitos en JavaScript puro sobre ideas parecidas:
un [coche autónomo con red neuronal](https://github.com/gniziemazity/Self-driving-car) y un
[editor de mundo virtual](https://github.com/gniziemazity/virtual-world).
