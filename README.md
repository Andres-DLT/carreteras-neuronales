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
- **Mis mapas**: guarda el mapa actual con un nombre, ábrelo o bórralo después, o
  empieza desde las plantillas *Circuito* y *Cuadrícula*. **Exportar mapa** descarga un
  archivo `.json` con el mapa y su cerebro entrenado; **Importar mapa** lo carga en
  otro navegador o dispositivo.
- **Entrenar**: todos los coches salen a la vez. Cuando chocan todos (o pasa un minuto
  simulado), el que más terreno exploró pasa su cerebro a la siguiente generación.
  En *Ajustes* se elige cuánto tráfico hay (0–30 coches) y si hay semáforos y peatones.
- **Cerebro por mapa**: cada mapa guarda su mejor cerebro. Al volver a un mapa ya
  entrenado se recupera su récord y su generación; en un mapa nuevo los coches parten
  de lo aprendido en el anterior.
- **Por qué se eliminan**: gráfica de barras con el porcentaje de coches de cada
  generación que acabó por choque, por pasarse un rojo, por atropello, por quedarse
  atascado o que seguía en pista al terminar.
- **3D**: el botón bajo la escala levanta edificios y árboles en perspectiva aérea.

## La ciudad

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

## Cómo funciona

| Archivo | Qué hace |
|---|---|
| `js/math.js` | Intersección de segmentos, punto en polígono, proyecciones. |
| `js/graph.js` | El grafo del mapa: puntos y tramos, con partir tramos y borrar. |
| `js/world.js` | Convierte cada tramo en un polígono redondeado y calcula la unión de todos para obtener los bordes; rejilla espacial para consultas rápidas; plantillas de mapa. |
| `js/network.js` | Red neuronal de propagación hacia delante (9 → 6 → 4) con activación escalón, clonado y mutación. |
| `js/car.js` | Física del coche, 7 sensores en abanico, choques y medición del terreno explorado. |
| `js/traffic.js` | Cruces, ciclo de los semáforos, pasos de cebra, peatones, coches de tráfico y obstáculos móviles. |
| `js/scenery.js` | Edificios a lo largo de las calles y arbolado en los huecos libres, en plano y en 3D. |
| `js/sim.js` | Generaciones: elitismo (el mejor pasa intacto), mutación escalonada, un 10 % de cerebros nuevos y más exploración si el récord se estanca. |
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
