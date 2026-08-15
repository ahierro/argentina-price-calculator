/* Gráfico de línea de una sola serie temporal, en SVG y sin dependencias.
   Lo usan las dos páginas del dólar, que solo cambian los datos y el formato.

   Uso:
     const g = crearGrafico({ svg, tooltip, formatoValor, formatoEje });
     g.dibujar([{ t, valor, etiqueta }, ...], { escala: 'log' });

   `t` es un milisegundo UTC y `etiqueta` es el texto de la fecha que se muestra
   al pasar el puntero. Devuelve la escala que realmente se usó. */

window.crearGrafico = function crearGrafico(config) {
  'use strict';

  const { svg, tooltip, formatoValor, formatoEje } = config;
  const DIA = 86400000;
  const NOMBRES_MES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  let VB = { ancho: 760, alto: 340 };
  let PLOT = { x: 0, y: 0, ancho: 0, alto: 0 };
  let conEtiquetaFinal = true;

  let serie = [];
  let escalaPedida = 'lineal';
  let puntos = [];
  let indiceActivo = -1;

  // El viewBox sigue al ancho real del contenedor, asi una unidad del dibujo
  // es un pixel en pantalla y el texto se lee igual en cualquier tamaño.
  function medir() {
    const ancho = Math.round(svg.parentElement.getBoundingClientRect().width) || 760;
    VB = { ancho, alto: Math.round(Math.min(Math.max(ancho * 0.46, 220), 340)) };

    // En pantallas angostas se cae la etiqueta del último valor: no entra.
    conEtiquetaFinal = ancho >= 480;
    const margen = { arriba: 16, derecha: conEtiquetaFinal ? 66 : 12, abajo: 28, izquierda: 50 };
    PLOT = {
      x: margen.izquierda,
      y: margen.arriba,
      ancho: VB.ancho - margen.izquierda - margen.derecha,
      alto: VB.alto - margen.arriba - margen.abajo
    };
    svg.setAttribute('viewBox', `0 0 ${VB.ancho} ${VB.alto}`);
  }

  // Paso de grilla "redondo" (1, 2, 5 por decada) para el eje de valores.
  function pasoLindo(rango, objetivo) {
    const bruto = rango / objetivo;
    const magnitud = Math.pow(10, Math.floor(Math.log10(bruto)));
    const normalizado = bruto / magnitud;
    const paso = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10;
    return paso * magnitud;
  }

  function marcasDeTiempo(tMin, tMax, maximo) {
    const marcas = [];
    const dias = (tMax - tMin) / DIA;
    const desde = new Date(tMin);
    const hasta = new Date(tMax);

    if (dias > 730) {
      const anios = hasta.getUTCFullYear() - desde.getUTCFullYear() + 1;
      const saltoAnios = Math.ceil(anios / maximo);
      for (let a = desde.getUTCFullYear(); a <= hasta.getUTCFullYear(); a += saltoAnios) {
        const enero = Date.UTC(a, 0, 1);
        // El primer año casi nunca arranca un 1 de enero: lo anclo al comienzo
        // de la serie, salvo que quede tan pegado al siguiente que choquen.
        const t = enero < tMin ? tMin : enero;
        if (t > tMax) continue;
        const siguiente = Date.UTC(a + saltoAnios, 0, 1);
        if (enero < tMin && (siguiente - t) / (tMax - tMin) < 0.04) continue;
        marcas.push({ t, etiqueta: String(a) });
      }
    } else {
      const total = Math.round(dias / 30);
      const salto = Math.max(1, Math.ceil(total / maximo));
      let a = desde.getUTCFullYear();
      let m = desde.getUTCMonth();
      let i = 0;
      while (Date.UTC(a, m, 1) <= tMax) {
        const primero = Date.UTC(a, m, 1);
        const t = primero < tMin ? tMin : primero;
        const siguiente = Date.UTC(m === 11 ? a + 1 : a, (m + 1) % 12, 1);
        const pegado = primero < tMin && (siguiente - t) / (tMax - tMin) < 0.04;
        if (t <= tMax && !pegado && i % salto === 0) {
          marcas.push({ t, etiqueta: NOMBRES_MES[m].slice(0, 3) + (m === 0 ? ` ${a}` : '') });
        }
        m++;
        if (m > 11) { m = 0; a++; }
        i++;
      }
    }
    return marcas;
  }

  // Marcas de una escala logaritmica: 1, 2 y 5 por decada, o solo las potencias
  // de diez si con las tres quedaria demasiado apretado.
  function marcasLogaritmicas(dMin, dMax) {
    const armar = (multiplicadores) => {
      const marcas = [];
      const desde = Math.floor(Math.log10(dMin));
      const hasta = Math.ceil(Math.log10(dMax));
      for (let e = desde; e <= hasta; e++) {
        for (const m of multiplicadores) {
          const v = m * Math.pow(10, e);
          if (v >= dMin && v <= dMax) marcas.push(v);
        }
      }
      return marcas;
    };
    const completas = armar([1, 2, 5]);
    return completas.length > 8 ? armar([1]) : completas;
  }

  function render() {
    puntos = [];
    indiceActivo = -1;
    ocultarLectura();
    medir();

    if (serie.length < 2) {
      svg.innerHTML = '';
      return 'lineal';
    }

    const tMin = serie[0].t;
    const tMax = serie[serie.length - 1].t;
    const valores = serie.map((d) => d.valor);
    const vMin = Math.min(...valores);
    const vMax = Math.max(...valores);

    // La escala logaritmica solo tiene sentido si el rango abarca varias veces
    // su propio piso; si no, se comporta como una lineal con marcas raras.
    const usarLog = escalaPedida === 'log' && vMin > 0 && vMax / vMin >= 3;

    let dMin;
    let dMax;
    let ejeY;
    let marcasY;

    if (usarLog) {
      dMin = vMin / 1.12;
      dMax = vMax * 1.12;
      const lgMin = Math.log10(dMin);
      const lgMax = Math.log10(dMax);
      ejeY = (v) => PLOT.y + PLOT.alto - ((Math.log10(v) - lgMin) / (lgMax - lgMin)) * PLOT.alto;
      marcasY = marcasLogaritmicas(dMin, dMax);
    } else {
      // Un respiro arriba y abajo para que la linea no toque los bordes.
      const respiro = (vMax - vMin) * 0.08 || Math.abs(vMax) * 0.05 || 1;
      dMin = vMin - respiro;
      dMax = vMax + respiro;
      if (vMin >= 0) dMin = Math.max(0, dMin); // un precio no baja de cero
      ejeY = (v) => PLOT.y + PLOT.alto - ((v - dMin) / (dMax - dMin)) * PLOT.alto;
      const paso = pasoLindo(dMax - dMin, 4);
      marcasY = [];
      for (let v = Math.ceil(dMin / paso) * paso; v <= dMax; v += paso) marcasY.push(v);
    }

    const ejeX = (t) => PLOT.x + ((t - tMin) / (tMax - tMin)) * PLOT.ancho;
    puntos = serie.map((d) => ({ x: ejeX(d.t), y: ejeY(d.valor), item: d }));

    // Una marca cada ~48px: suficiente aire para que no se toquen los rótulos.
    const marcasX = marcasDeTiempo(tMin, tMax, Math.max(2, Math.floor(PLOT.ancho / 48)));

    const grilla = marcasY
      .map((v) => {
        const y = ejeY(v).toFixed(1);
        return `<line class="g-grilla" x1="${PLOT.x}" y1="${y}" x2="${PLOT.x + PLOT.ancho}" y2="${y}"/>` +
          `<text class="g-eje" x="${PLOT.x - 10}" y="${y}" text-anchor="end" dominant-baseline="middle">${formatoEje(v)}</text>`;
      })
      .join('');

    const ejeInferior = marcasX
      .map((m) => {
        const x = ejeX(m.t).toFixed(1);
        return `<text class="g-eje" x="${x}" y="${PLOT.y + PLOT.alto + 18}" text-anchor="middle">${m.etiqueta}</text>`;
      })
      .join('');

    const trazo = puntos
      .map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1))
      .join(' ');

    const fin = puntos[puntos.length - 1];

    svg.innerHTML =
      grilla +
      `<line class="g-base" x1="${PLOT.x}" y1="${PLOT.y + PLOT.alto}" x2="${PLOT.x + PLOT.ancho}" y2="${PLOT.y + PLOT.alto}"/>` +
      ejeInferior +
      `<path class="g-linea" d="${trazo}"/>` +
      `<circle class="g-fin" cx="${fin.x.toFixed(1)}" cy="${fin.y.toFixed(1)}" r="4"/>` +
      (conEtiquetaFinal
        ? `<text class="g-etiqueta" x="${(fin.x + 9).toFixed(1)}" y="${fin.y.toFixed(1)}" dominant-baseline="middle">${formatoValor(fin.item.valor)}</text>`
        : '') +
      `<g class="g-cruz" hidden>` +
      `<line class="g-cruz-linea" y1="${PLOT.y}" y2="${PLOT.y + PLOT.alto}"/>` +
      `<circle class="g-cruz-punto" r="4.5"/>` +
      `</g>` +
      `<rect class="g-captura" x="${PLOT.x}" y="${PLOT.y}" width="${PLOT.ancho}" height="${PLOT.alto}"/>`;

    return usarLog ? 'log' : 'lineal';
  }

  // --- lectura al pasar el puntero o con el teclado -------------------------

  function mostrarLectura(indice) {
    if (indice < 0 || indice >= puntos.length) return;
    indiceActivo = indice;
    const p = puntos[indice];
    const cruz = svg.querySelector('.g-cruz');
    if (!cruz) return;

    cruz.removeAttribute('hidden');
    cruz.querySelector('.g-cruz-linea').setAttribute('x1', p.x);
    cruz.querySelector('.g-cruz-linea').setAttribute('x2', p.x);
    cruz.querySelector('.g-cruz-punto').setAttribute('cx', p.x);
    cruz.querySelector('.g-cruz-punto').setAttribute('cy', p.y);

    tooltip.replaceChildren();
    const valor = document.createElement('strong');
    valor.textContent = formatoValor(p.item.valor);
    const fecha = document.createElement('span');
    fecha.textContent = p.item.etiqueta;
    const clave = document.createElement('i');
    clave.className = 'g-clave';
    tooltip.append(valor, fecha, clave);

    // Se ancla al punto y se corre al otro lado si se saldria del lienzo.
    const porcentaje = (p.x / VB.ancho) * 100;
    tooltip.style.left = porcentaje + '%';
    tooltip.classList.toggle('a-la-izquierda', porcentaje > 70);
    tooltip.hidden = false;
  }

  function ocultarLectura() {
    indiceActivo = -1;
    tooltip.hidden = true;
    const cruz = svg.querySelector('.g-cruz');
    if (cruz) cruz.setAttribute('hidden', '');
  }

  // El lector apunta a una fecha, no a la linea: se busca el punto mas cercano
  // sobre el eje del tiempo.
  function indiceMasCercano(x) {
    let inicio = 0;
    let fin = puntos.length - 1;
    while (fin - inicio > 1) {
      const medio = (inicio + fin) >> 1;
      if (puntos[medio].x < x) inicio = medio; else fin = medio;
    }
    return Math.abs(puntos[inicio].x - x) <= Math.abs(puntos[fin].x - x) ? inicio : fin;
  }

  svg.addEventListener('pointermove', (ev) => {
    if (puntos.length === 0) return;
    const caja = svg.getBoundingClientRect();
    const x = (ev.clientX - caja.left) * (VB.ancho / caja.width);
    if (x < PLOT.x || x > PLOT.x + PLOT.ancho) { ocultarLectura(); return; }
    mostrarLectura(indiceMasCercano(x));
  });
  svg.addEventListener('pointerleave', ocultarLectura);

  // Mismo detalle con el teclado que con el puntero.
  svg.setAttribute('tabindex', '0');
  svg.addEventListener('focus', () => {
    if (indiceActivo === -1) mostrarLectura(puntos.length - 1);
  });
  svg.addEventListener('blur', ocultarLectura);
  svg.addEventListener('keydown', (ev) => {
    const direccion = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
    if (direccion === 0) {
      if (ev.key === 'Escape') ocultarLectura();
      return;
    }
    ev.preventDefault();
    const base = indiceActivo === -1 ? puntos.length - 1 : indiceActivo;
    const paso = ev.shiftKey ? 10 : 1;
    mostrarLectura(Math.min(Math.max(base + direccion * paso, 0), puntos.length - 1));
  });

  // El dibujo depende del ancho disponible, asi que se rehace al redimensionar.
  let pendiente = 0;
  window.addEventListener('resize', () => {
    clearTimeout(pendiente);
    pendiente = setTimeout(render, 150);
  });

  return {
    dibujar(nuevaSerie, opciones) {
      serie = nuevaSerie;
      escalaPedida = (opciones && opciones.escala) || 'lineal';
      return render();
    }
  };
};
