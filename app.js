/* Calculadora de variación histórica entre dos meses.
   La usan la página de inflación y la de devaluación: cambia el CSV, no la
   cuenta. La fuente se elige con data-csv en el <body>. */

(async function () {
  'use strict';

  const NOMBRES_MES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  // --- datos -------------------------------------------------------------

  function fallar(mensaje) {
    const aviso = document.getElementById('aviso');
    aviso.textContent = mensaje;
    aviso.hidden = false;
  }

  const csv = document.body.dataset.csv || 'inflacionmensual.csv';
  // Con data-csv-dolar la serie es el cociente entre las dos: la variación de
  // precios medida en dólares.
  const csvDolar = document.body.dataset.csvDolar || null;
  const simbolo = document.body.dataset.simbolo || '$';

  let puntos;
  try {
    puntos = csvDolar
      ? await Datos.serieEnDolares(csv, csvDolar)
      : await Datos.serieMensual(csv);
  } catch (error) {
    fallar(error.message);
    return;
  }

  // Cada fila es un mes elegible, con el indice a precios del dia 1 y la
  // variacion que ocurre DURANTE ese mes (null en el ultimo, que todavia no
  // tiene dato). Por eso convertir de A a B acumula las variaciones de los
  // meses A, A+1, ..., B-1.
  const filas = puntos.map((p, i) => ({ ...p, i, clave: p.anio * 12 + (p.mes - 1) }));

  if (filas.length < 2) {
    fallar(`${csv} no tiene suficientes meses para convertir.`);
    return;
  }

  const porClave = new Map(filas.map((f) => [f.clave, f]));
  const primero = filas[0];
  const ultimo = filas[filas.length - 1];
  const anios = [...new Set(filas.map((f) => f.anio))].sort((a, b) => a - b);

  // --- formato de números ------------------------------------------------

  const fMonto = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const fPorcentaje = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  // Acepta tanto "1.234,56" (es-AR) como "1234.56".
  function parsearMonto(texto) {
    const limpio = String(texto).replace(/[\s$ ]/g, '');
    if (limpio === '') return NaN;

    let normalizado;
    if (limpio.includes(',') && limpio.includes('.')) {
      // El último separador que aparece es el decimal.
      normalizado = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
        ? limpio.replace(/\./g, '').replace(',', '.')
        : limpio.replace(/,/g, '');
    } else if (limpio.includes(',')) {
      normalizado = limpio.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) {
      normalizado = limpio.replace(/\./g, ''); // "1.500" son mil quinientos
    } else {
      normalizado = limpio;
    }

    return /^-?\d*\.?\d*$/.test(normalizado) ? Number(normalizado) : NaN;
  }

  const porcentaje = (x) => fPorcentaje.format(x) + '%';
  const etiquetaMes = (f) => NOMBRES_MES[f.mes - 1] + ' de ' + f.anio;

  // --- armado de los selectores -----------------------------------------

  const el = (id) => document.getElementById(id);
  const campos = {
    montoOrigen: el('monto-origen'),
    montoDestino: el('monto-destino'),
    mesOrigen: el('mes-origen'),
    anioOrigen: el('anio-origen'),
    mesDestino: el('mes-destino'),
    anioDestino: el('anio-destino')
  };

  // --- cotización de referencia (opcional) ---------------------------------

  /* Si la página tiene los huecos para mostrarla, se carga el tipo de cambio y
     se indica junto a cada fecha la cotización de ese momento. Como un mes se
     toma a valores de comienzo de mes, la cotización que corresponde es la del
     último día con dato del mes anterior. */

  const huecosTc = { origen: el('tc-origen'), destino: el('tc-destino') };
  let ultimaDelMes = null;

  if (huecosTc.origen && huecosTc.destino) {
    try {
      const { cotizaciones } = await Datos.tipoDeCambio();
      // Vienen ordenadas, así que la última que se guarda de cada mes es la del
      // día más avanzado.
      ultimaDelMes = new Map();
      for (const c of cotizaciones) ultimaDelMes.set(c.anio * 12 + (c.mes - 1), c);
    } catch (error) {
      // Sin cotizaciones la calculadora sigue funcionando igual.
      ultimaDelMes = null;
    }
  }

  const dosDigitos = (n) => String(n).padStart(2, '0');
  const fechaCorta = (c) => `${dosDigitos(c.dia)}/${dosDigitos(c.mes)}/${c.anio}`;

  function mostrarCotizacion(hueco, punto) {
    if (!hueco || !ultimaDelMes) return;
    const cotizacion = ultimaDelMes.get(punto.clave - 1);
    if (!cotizacion) {
      hueco.textContent = '';
      hueco.removeAttribute('title');
      return;
    }
    hueco.textContent = `1 USD = $${fMonto.format(cotizacion.valor)}`;
    hueco.title =
      `Cotización del ${fechaCorta(cotizacion)}, el último día con dato anterior a ` +
      `${etiquetaMes(punto)}.`;
  }

  function llenarSelectores(selectMes, selectAnio) {
    NOMBRES_MES.forEach((nombre, i) => {
      selectMes.add(new Option(nombre, String(i + 1)));
    });
    anios.forEach((anio) => selectAnio.add(new Option(String(anio), String(anio))));
  }

  // Deshabilita los meses que no existen para el año elegido (por ejemplo,
  // los meses posteriores al último dato disponible).
  function ajustarMesesDisponibles(selectMes, selectAnio) {
    const anio = Number(selectAnio.value);
    let disponibles = [];

    for (const opcion of selectMes.options) {
      const existe = porClave.has(anio * 12 + (Number(opcion.value) - 1));
      opcion.disabled = !existe;
      if (existe) disponibles.push(Number(opcion.value));
    }

    if (!disponibles.includes(Number(selectMes.value)) && disponibles.length > 0) {
      const objetivo = Number(selectMes.value);
      const cercano = disponibles.reduce((a, b) =>
        Math.abs(b - objetivo) < Math.abs(a - objetivo) ? b : a);
      selectMes.value = String(cercano);
    }
  }

  const mesSeleccionado = (selectMes, selectAnio) =>
    porClave.get(Number(selectAnio.value) * 12 + (Number(selectMes.value) - 1));

  function fijarMes(selectMes, selectAnio, fila) {
    selectAnio.value = String(fila.anio);
    ajustarMesesDisponibles(selectMes, selectAnio);
    selectMes.value = String(fila.mes);
  }

  // --- cálculo -----------------------------------------------------------

  // `ultimoEditado` decide qué monto es el dato y cuál el resultado.
  let ultimoEditado = 'origen';

  function recalcular() {
    const origen = mesSeleccionado(campos.mesOrigen, campos.anioOrigen);
    const destino = mesSeleccionado(campos.mesDestino, campos.anioDestino);
    const aviso = el('aviso');
    const resumen = el('resumen');

    mostrarCotizacion(huecosTc.origen, origen);
    mostrarCotizacion(huecosTc.destino, destino);

    const entrada = ultimoEditado === 'origen' ? campos.montoOrigen : campos.montoDestino;
    const salida = ultimoEditado === 'origen' ? campos.montoDestino : campos.montoOrigen;
    const monto = parsearMonto(entrada.value);

    if (!Number.isFinite(monto)) {
      entrada.classList.add('invalido');
      salida.value = '';
      resumen.textContent = '';
      aviso.textContent = 'Ingresá un monto válido.';
      aviso.hidden = false;
      renderTabla(origen, destino);
      renderGrafico(null);
      return;
    }

    entrada.classList.remove('invalido');
    aviso.hidden = true;

    // Factor de precios entre ambos meses: cuánto vale en el mes de destino
    // un peso del mes de origen.
    const factor = destino.indice / origen.indice;
    const resultado = ultimoEditado === 'origen' ? monto * factor : monto / factor;
    salida.value = fMonto.format(resultado);

    resumen.innerHTML = textoResumen(origen, destino, factor);
    renderTabla(origen, destino);
    renderGrafico({
      origen,
      destino,
      // El monto expresado en pesos del mes de origen, que es el ancla del
      // gráfico sin importar cuál de los dos campos escribió el lector.
      montoEnOrigen: ultimoEditado === 'origen' ? monto : resultado
    });
  }

  function textoResumen(origen, destino, factor) {
    if (origen.clave === destino.clave) {
      return 'Es el mismo mes, así que el monto no cambia.';
    }

    const meses = Math.abs(destino.clave - origen.clave);
    const variacionTotal = (factor - 1) * 100;
    const mensualPromedio = (Math.pow(factor, 1 / meses) - 1) * 100;
    const anualizada = (Math.pow(1 + mensualPromedio / 100, 12) - 1) * 100;
    const sube = factor >= 1;
    const palabra = sube ? 'incremento' : 'una disminución';
    const articulo = sube ? 'un ' : '';

    return (
      'Esto representa ' + articulo + palabra + ' del <strong>' +
      porcentaje(Math.abs(variacionTotal)) + '</strong> en ' +
      meses + (meses === 1 ? ' mes' : ' meses') + ', es decir, ' + articulo + palabra +
      ' promedio del <strong>' + porcentaje(Math.abs(mensualPromedio)) +
      ' por mes</strong> (<strong>' + porcentaje(Math.abs(anualizada)) + ' anualizado</strong>).'
    );
  }

  // --- tabla del período -------------------------------------------------

  function renderTabla(origen, destino) {
    const cuerpo = document.querySelector('#tabla-meses tbody');
    const encabezado = document.querySelector('#tabla-meses thead th:last-child');
    const seccion = document.querySelector('.detalle');

    if (origen.clave === destino.clave) {
      seccion.hidden = true;
      return;
    }
    seccion.hidden = false;

    const desde = origen.clave < destino.clave ? origen : destino;
    const hasta = origen.clave < destino.clave ? destino : origen;
    encabezado.textContent = 'Acumulado desde ' + etiquetaMes(desde);

    // Los meses que transcurren entre ambas fechas: desde el mes de inicio
    // hasta el anterior al de llegada.
    const tramo = filas.slice(desde.i, hasta.i);
    cuerpo.innerHTML = tramo
      .map((f) => {
        // El acumulado de un mes se mide contra el comienzo del mes siguiente.
        const acumulado = (filas[f.i + 1].indice / desde.indice - 1) * 100;
        return '<tr><td>' + etiquetaMes(f) + '</td><td>' + porcentaje(f.variacion) +
          '</td><td>' + porcentaje(acumulado) + '</td></tr>';
      })
      .join('');
  }

  // --- gráfico del período -------------------------------------------------

  const figura = el('grafico');
  const boton = el('ver-grafico');
  const fGrafico = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const fGraficoEje = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

  const grafico = crearGrafico({
    svg: el('grafico-svg'),
    tooltip: el('grafico-tooltip'),
    formatoValor: (v) => simbolo + fGrafico.format(v),
    formatoEje: (v) => fGraficoEje.format(v)
  });

  let estado = null;

  function renderGrafico(nuevoEstado) {
    estado = nuevoEstado;
    if (figura.hidden) return; // se dibuja recién al abrirlo: oculto mide cero

    if (!estado || estado.origen.clave === estado.destino.clave) {
      grafico.dibujar([]);
      el('grafico-titulo').textContent = 'Evolución mes a mes';
      el('grafico-resumen').textContent = !estado
        ? 'Ingresá un monto válido para ver el gráfico.'
        : 'Elegí dos meses distintos para ver la evolución.';
      return;
    }

    const { origen, destino, montoEnOrigen } = estado;
    const desde = origen.clave < destino.clave ? origen : destino;
    const hasta = origen.clave < destino.clave ? destino : origen;

    // El mismo monto expresado a precios de cada mes del período.
    const serie = filas.slice(desde.i, hasta.i + 1).map((f) => ({
      t: Date.UTC(f.anio, f.mes - 1, 1),
      valor: montoEnOrigen * (f.indice / origen.indice),
      etiqueta: etiquetaMes(f)
    }));

    // La escala logarítmica solo entra si el monto se multiplica varias veces;
    // el módulo vuelve solo a la lineal cuando el rango es chico.
    const escalaUsada = grafico.dibujar(serie, { escala: 'log' });

    el('grafico-titulo').textContent =
      `Cuánto vale ese monto en cada mes${escalaUsada === 'log' ? ' (escala logarítmica)' : ''}`;
    el('grafico-resumen').textContent =
      `De ${simbolo}${fGrafico.format(serie[0].valor)} en ${etiquetaMes(desde)} a ` +
      `${simbolo}${fGrafico.format(serie[serie.length - 1].valor)} en ${etiquetaMes(hasta)}, ` +
      `mes a mes. Las variaciones de cada mes están en la tabla de abajo.`;
  }

  boton.addEventListener('click', () => {
    const mostrar = figura.hidden;
    figura.hidden = !mostrar;
    boton.setAttribute('aria-expanded', String(mostrar));
    boton.textContent = mostrar ? 'Ocultar gráfico' : 'Ver gráfico';
    if (mostrar) renderGrafico(estado);
  });

  // --- inicialización ----------------------------------------------------

  llenarSelectores(campos.mesOrigen, campos.anioOrigen);
  llenarSelectores(campos.mesDestino, campos.anioDestino);

  // Por defecto: mismo mes del año anterior contra el último dato disponible.
  const inicioPorDefecto = porClave.get(ultimo.clave - 12) || primero;
  fijarMes(campos.mesOrigen, campos.anioOrigen, inicioPorDefecto);
  fijarMes(campos.mesDestino, campos.anioDestino, ultimo);

  el('rango-desde').textContent = etiquetaMes(primero);
  el('rango-hasta').textContent = etiquetaMes(ultimo);

  campos.montoOrigen.addEventListener('input', () => {
    ultimoEditado = 'origen';
    recalcular();
  });
  campos.montoDestino.addEventListener('input', () => {
    ultimoEditado = 'destino';
    recalcular();
  });

  [['mesOrigen', 'anioOrigen'], ['mesDestino', 'anioDestino']].forEach(([mes, anio]) => {
    campos[anio].addEventListener('change', () => {
      ajustarMesesDisponibles(campos[mes], campos[anio]);
      recalcular();
    });
    campos[mes].addEventListener('change', recalcular);
  });

  el('invertir').addEventListener('click', () => {
    const origen = mesSeleccionado(campos.mesOrigen, campos.anioOrigen);
    const destino = mesSeleccionado(campos.mesDestino, campos.anioDestino);
    fijarMes(campos.mesOrigen, campos.anioOrigen, destino);
    fijarMes(campos.mesDestino, campos.anioDestino, origen);

    // Al invertir, el monto que el usuario cargó viaja con su mes.
    const montoOrigen = campos.montoOrigen.value;
    campos.montoOrigen.value = campos.montoDestino.value;
    campos.montoDestino.value = montoOrigen;
    ultimoEditado = ultimoEditado === 'origen' ? 'destino' : 'origen';

    recalcular();
  });

  recalcular();
})();
