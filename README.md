# Calculadora de inflación histórica de Argentina

Página estática que convierte montos entre dos meses usando el IPC mensual de
`inflacionmensual.csv`.

**No hay paso de build ni datos copiados a mano.** `datos.js` lee los CSV con `fetch`
cada vez que se abre una página, así que el rango de fechas, los selectores y todos
los cálculos salen del contenido actual de los archivos: si cambia el CSV, cambia la
página con solo recargar.

## Cómo funciona

`datos.js` lee el CSV (`dd/mm/aaaa;variación mensual %`, con la fecha del último día
del mes al que corresponde la variación) y arma un índice de precios encadenado,
tomando el primer mes como base 100.

El índice está **a precios de comienzo de mes**: el nivel de un mes es el anterior
a aplicar su propia variación, porque elegir «julio de 2026» en la calculadora
significa los precios al 1 de julio.

```
indice[m+1] = indice[m] * (1 + variacion[m] / 100)
```

Convertir un monto del mes A al mes B es multiplicarlo por `indice[B] / indice[A]`,
lo que acumula las variaciones de los meses A, A+1, …, B-1: los que transcurren
entre ambas fechas. La variación promedio mensual del período es
`(indice[B]/indice[A])^(1/n) - 1` con `n` = cantidad de meses, y la anualizada
`(1 + promedio)^12 - 1`.

El botón «Ver gráfico» despliega la evolución mes a mes del monto: el mismo importe
expresado a precios de cada mes del período, anclado en el mes de origen. Cada punto
del gráfico da el mismo número que devolvería la calculadora eligiendo ese mes como
destino. Se dibuja recién al abrirlo, porque oculto el contenedor mide cero.

Con `n` variaciones se encadenan `n + 1` niveles de precios, porque una variación es
el paso entre dos meses. Por eso los meses elegibles son uno más que las filas del
CSV: con datos de junio de 2017 a julio de 2026 (110 filas), el rango va de junio de
2017 a agosto de 2026 (111 meses). No hay ningún mes inventado — el nivel de agosto
de 2026 es justamente lo que dice la última fila del CSV.

## `/devaluacion`

La misma calculadora, pero sobre `devaluacion_mensual.csv`: la devaluación mensual del
peso frente al dólar, calculada sobre las cotizaciones de cierre vendedor que publica
el BCRA en <https://www.bcra.gob.ar/evolucion-moneda>.

Comparte `app.js` con la página de inflación —la cuenta es idéntica, solo cambia la
serie— y elige la fuente con `data-csv` en el `<body>`:

```html
<body data-csv="devaluacion_mensual.csv">
```

Sin ese atributo se usa `inflacionmensual.csv`, que es lo que hace la página principal.
La única diferencia de fondo es que la devaluación mensual puede ser negativa cuando el
peso se aprecia, así que la serie no siempre sube.

Al lado de cada año se muestra la cotización de ese momento (`1 USD = $1.485,00`), leída
de `tipo_de_cambio.csv`. Como un mes se toma a valores de comienzo de mes, la cotización
que corresponde es la del **último día con dato del mes anterior**: para agosto de 2026
es la del 31/07/2026. El detalle completo está en el `title` de cada valor.

Esos dos huecos son opcionales: `app.js` carga el tipo de cambio solo si encuentra los
elementos `#tc-origen` y `#tc-destino`, así que la página de inflación no lo pide.

## `/inflacion_en_dolares`

Cuánto se movieron los precios argentinos medidos en dólares. Se ingresa y se obtiene un
monto en dólares. Combina las dos series mensuales:

```
variación en dólares = (1 + IPC) / (1 + devaluación) - 1
```

**Es un cociente, no una resta**, y la diferencia es enorme en esta serie. En diciembre de
2023 el IPC fue 25,47% y la devaluación 124,26%: restando da −98,79%, que implicaría que
los precios en dólares se derrumbaron casi por completo en un mes; el cociente da −44,05%
(1,2547 / 2,2426 = 0,5595). Sobre todo el período, US$100 pasan a US$118,48 con el
cociente y a US$1,74 con la resta.

El resultado se verifica contra las otras dos calculadoras: 109,2837 (factor del IPC)
dividido 92,2360 (factor de la devaluación) da 1,1848, el mismo 18,48%.

Usa el mismo `app.js`, con dos atributos más en el `<body>`:

```html
<body data-csv="inflacionmensual.csv"
      data-csv-dolar="devaluacion_mensual.csv"
      data-simbolo="US$">
```

`data-csv-dolar` es lo que dispara la combinación; sin ese atributo la página usa una sola
serie. `data-simbolo` cambia el signo en el gráfico y en sus textos.

## `/dolar_ajustado`

Segunda página con la serie diaria de `tipo_de_cambio.csv` y una columna extra: cada
cotización llevada a precios del último mes disponible del IPC.

```
ajustado = tipo de cambio * indice[mes de referencia] / indice[del dia]
```

Para ubicar un día dentro de su mes, el índice se interpola geométricamente entre el
comienzo de ese mes y el del siguiente, así la serie no salta en cada cambio de mes.
En el último mes, que todavía no tiene inflación publicada, se usa el nivel de
comienzo de mes y el ajuste queda en 1.

El rango lo manda el IPC: las cotizaciones cuyo mes no está en `inflacionmensual.csv`
no se pueden ajustar y quedan fuera del cuadro, con un aviso que dice cuántas son y
qué período abarcan.

Incluye un gráfico de la serie ajustada (SVG dibujado a mano, sin librerías) con
lectura al pasar el puntero o con las flechas del teclado. El filtro por año alcanza
al gráfico, a las tarjetas de resumen y a la tabla, así que los tres muestran siempre
el mismo recorte. El `viewBox` se recalcula según el ancho disponible para que el
texto del gráfico se lea igual en cualquier pantalla.

## Actualizar los datos

Agregá los meses nuevos al final de `inflacionmensual.csv` y los días nuevos al final
de `tipo_de_cambio.csv`. No hay nada que regenerar: alcanza con recargar la página.

Las páginas validan lo que leen y avisan en pantalla: si al IPC le falta un mes en el
medio se corta con un error (el encadenado quedaría mal), y si `tipo_de_cambio.csv`
trae una fecha repetida se conserva la primera cotización y se avisa cuántas hubo.

## Ver la página

Hace falta un servidor estático, porque las páginas leen los CSV con `fetch` y eso no
funciona abriendo los archivos con `file://`.

```bash
npx serve --listen 4173 .
```

## Archivos

- `index.html` — la calculadora de inflación.
- `devaluacion.html` — la calculadora de devaluación (`/devaluacion`).
- `inflacion_en_dolares.html` — la inflación medida en dólares (`/inflacion_en_dolares`).
- `app.js` — la calculadora, compartida por las tres páginas anteriores.
- `dolar_ajustado.html`, `app-dolar.js` — la serie del dólar ajustado (`/dolar_ajustado`).
- `datos.js` — lectura y validación de los CSV, compartida por las cuatro páginas.
- `grafico.js` — el gráfico de línea, compartido por las cuatro páginas.
- `estilos.css` — estilos compartidos por las cuatro páginas.
- `inflacionmensual.csv` — IPC mensual.
- `devaluacion_mensual.csv` — devaluación mensual del peso.
- `tipo_de_cambio.csv` — tipo de cambio diario.
 
Tipo de cambio https://www.bcra.gob.ar/evolucion-moneda -> Dolar estadounidense -> MERCADO DE CAMBIOS - COTIZACIONES CIERRE VENDEDOR

Índice de Precios al Consumidor. Nivel General. Base diciembre 2016. Valores mensual

https://www.datos.gob.ar/es/dataset/indice-de-precios-al-consumidor-nacional-ipc-base-diciembre-2016/resource/aa08d18e-f55e-5c1c-965e-1b7be444eda1

https://infra.datos.gob.ar/catalog/sspm/dataset/145/distribution/145.3/download/indice-precios-al-consumidor-nivel-general-base-diciembre-2016-mensual.csv