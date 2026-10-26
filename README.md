# Carreteras Neuronales

Un mundo virtual en JavaScript puro (sin librerías) donde dibujas carreteras y una
población de coches autónomos aprende a conducir por ellas mediante una red neuronal
y un algoritmo genético.

## Cómo abrirlo

Los scripts son clásicos (no módulos), así que basta con abrir `index.html` en el
navegador. Si prefieres un servidor local:

```bash
py -m http.server 8765 --directory carreteras-neuronales
```

y abre http://localhost:8765.

## Cómo se usa

- **Editar mapa**: toca para poner puntos; cada uno se une al anterior. Toca un punto
  existente para conectarlo (o el último otra vez para terminar el tramo). Tocar sobre
  una carretera la parte en dos y crea un cruce. Arrastra puntos para moverlos y el
  fondo para desplazarte; rueda o pellizco para el zoom. La herramienta *Salida*
  coloca la línea de salida (tócala otra vez para invertir el sentido).
- **Entrenar**: todos los coches salen a la vez. Cuando chocan todos (o pasa un minuto
  simulado), el que más terreno exploró pasa su cerebro a la siguiente generación.

## Cómo funciona

| Archivo | Qué hace |
|---|---|
| `js/math.js` | Intersección de segmentos, punto en polígono, proyecciones. |
| `js/graph.js` | El grafo del mapa: puntos y tramos, con partir tramos y borrar. |
| `js/world.js` | Convierte cada tramo en un polígono redondeado y calcula la unión de todos para obtener los bordes; rejilla espacial para consultas rápidas; mapa de ejemplo. |
| `js/network.js` | Red neuronal de propagación hacia delante (7 → 6 → 4) con activación escalón, clonado y mutación. |
| `js/car.js` | Física del coche, 7 sensores en abanico, choques y medición del terreno explorado. |
| `js/sim.js` | Generaciones: elitismo (el mejor pasa intacto), mutación escalonada, un 10 % de cerebros nuevos y más exploración si el récord se estanca. |
| `js/app.js` | Interfaz: editor, cámara, gestos táctiles, dibujo y visualizador de la red. |

**Aptitud**: la superficie distinta que pisa cada coche (celdas de 3.75 m). Dar
vueltas en el mismo sitio no suma, y un coche que pasa 2.5 s sin pisar terreno nuevo
se retira.

**Escala**: un coche mide 48 unidades, que equivalen a 4.5 m; la carretera mide unos
9.4 m de ancho y la velocidad máxima ronda los 65 km/h.

El mapa, el mejor cerebro y el récord se guardan en el navegador (`localStorage`).
