# Carreteras Neuronales

Un mundo virtual en JavaScript puro (sin librerías) donde dibujas carreteras y una
población de coches autónomos aprende a conducir por ellas mediante una red neuronal
y un algoritmo genético. La ciudad tiene tráfico, semáforos, peatones, edificios y
árboles, con vista en 3D.

**▶ Juega aquí: https://andres-dlt.github.io/carreteras-neuronales/**

## Cómo abrirlo

Los scripts son clásicos (no módulos), así que basta con abrir `index.html` en el
navegador. Si prefieres un servidor local:

```bash
py -m http.server 8765
```

y abre http://localhost:8765.

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
- **3D**: el botón bajo la escala levanta edificios y árboles en perspectiva aérea.

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
| `js/world.js` | Convierte cada tramo en un polígono redondeado y calcula la unión de todos para obtener los bordes; puentes en un nivel aparte; marcas viales de cada tipo; rejilla espacial. |
| `js/maps.js` | Plantillas de mapa y generador de ciudades al azar con semilla. |
| `js/real-maps.js` | Barrios reales convertidos de OpenStreetMap. |
| `js/network.js` | Red neuronal de propagación hacia delante (9 → 6 → 4) con activación escalón, mutación y cruce. |
| `js/car.js` | Física del coche, 7 sensores en abanico, choques y medición del terreno explorado. |
| `js/traffic.js` | Cruces, ciclo de los semáforos, pasos de cebra, peatones, coches de tráfico y obstáculos móviles. |
| `js/scenery.js` | Edificios a lo largo de las calles y arbolado en los huecos libres, en plano y en 3D. |
| `js/worker.js` | Entrenamiento turbo: la misma simulación en un Web Worker, avisando al final de cada generación. |
| `js/sim.js` | Generaciones: elitismo (el mejor pasa intacto), mutantes del mejor con intensidad escalonada, hijos de cruzar a los 5 mejores, un 10 % de cerebros nuevos y más exploración si el récord se estanca. Con la gira todoterreno, una manga por mapa. |
| `js/app.js` | Interfaz: editor, mapas guardados, cámara, gestos táctiles, dibujo y visualizador de la red. |

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
