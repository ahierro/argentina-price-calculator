/* Serie diaria del tipo de cambio ajustada por inflación IPC.
   Lee los dos CSV en el momento a través de datos.js. */

(async function () {
  'use strict';

  const NOMBRES_MES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  const aviso = document.getElementById('aviso');

  function fallar(mensaje) {
    aviso.textContent = mensaje;
    aviso.classList.remove('aviso-nota');
    aviso.hidden = false;
  }

  // Igual que fallar, pero para algo que el lector conviene que sepa sin que
  // sea un error.
  function notar(mensaje) {
    aviso.textContent = mensaje;
    aviso.classList.add('aviso-nota');
    aviso.hidden = false;
  }

  let ipc;
  let cotizaciones;
  let duplicados;
  try {
    const [puntos, tc] = await Promise.all([Datos.serieMensual(), Datos.tipoDeCambio()]);
    ipc = puntos;
    cotizaciones = tc.cotizaciones;
    duplicados = tc.duplicados;
  } catch (error) {
    fallar(error.message);
    return;
  }

  if (ipc.length < 2 || cotizaciones.length === 0) {
    fallar('Los CSV no tienen suficientes datos.');
    return;
  }

  const ipcPorClave = new Map(ipc.map((p) => [p.anio * 12 + (p.mes - 1), p]));
  const referencia = ipc[ipc.length - 1];

  // --- formato ------------------------------------------------------------

  const fNominal = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 3
  });
  const fAjustado = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const fEje = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const dosDigitos = (n) => String(n).padStart(2, '0');
  const fechaCorta = (d) => `${dosDigitos(d.dia)}/${dosDigitos(d.mes)}/${d.anio}`;
  const etiquetaMes = (p) => NOMBRES_MES[p.mes - 1] + ' de ' + p.anio;

  // --- ajuste por inflación ------------------------------------------------

  // Índice de precios del día: dentro del mes se interpola geométricamente
  // entre el comienzo de ese mes y el del siguiente, para que la serie no
  // salte de golpe en cada cambio de mes.
  function indiceDelDia(anio, mes, dia) {
    const punto = ipcPorClave.get(anio * 12 + (mes - 1));
    if (!punto) return null;
    if (punto.variacion === null) return punto.indice; // mes sin inflación publicada
    const diasDelMes = new Date(anio, mes, 0).getDate();
    const fraccion = Math.min(Math.max((dia - 1) / diasDelMes, 0), 1);
    return punto.indice * Math.pow(1 + punto.variacion / 100, fraccion);
  }

  // El rango es el que permite el IPC: las cotizaciones cuyo mes no está en
  // inflacionmensual.csv no se pueden ajustar, así que quedan afuera.
  const fuera = [];
  const serie = [];
  for (const d of cotizaciones) {
    const indice = indiceDelDia(d.anio, d.mes, d.dia);
    if (indice === null) { fuera.push(d); continue; }
    serie.push({ ...d, ajustado: d.valor * (referencia.indice / indice) });
  }

  if (serie.length === 0) {
    fallar(
      `Ninguna cotización cae dentro del rango del IPC ` +
      `(${etiquetaMes(ipc[0])} a ${etiquetaMes(referencia)}).`
    );
    return;
  }

  const notas = [];
  if (fuera.length > 0) {
    notas.push(
      `${fuera.length} cotizaciones quedan fuera del cuadro porque el IPC arranca en ` +
      `${etiquetaMes(ipc[0])}: van del ${fechaCorta(fuera[0])} al ${fechaCorta(fuera[fuera.length - 1])}.`
    );
  }
  if (duplicados.length > 0) {
    notas.push(
      `${duplicados.length} fecha(s) repetida(s) en tipo_de_cambio.csv: se conserva la primera cotización.`
    );
  }
  if (notas.length > 0) notar(notas.join(' '));

  // --- resumen -------------------------------------------------------------

  const texto = (id, valor) => { document.getElementById(id).textContent = valor; };

  texto('mes-referencia', etiquetaMes(referencia));
  document.getElementById('grafico-titulo').textContent =
    'Dólar ajustado a precios de ' + etiquetaMes(referencia);
  document.getElementById('th-ajustado').textContent =
    'Ajustado a precios de ' + etiquetaMes(referencia);

  function resumir(filas) {
    const conAjuste = filas.filter((d) => d.ajustado !== null);
    if (conAjuste.length === 0) return null;
    return {
      maximo: conAjuste.reduce((a, b) => (b.ajustado > a.ajustado ? b : a)),
      minimo: conAjuste.reduce((a, b) => (b.ajustado < a.ajustado ? b : a)),
      promedio: conAjuste.reduce((suma, d) => suma + d.ajustado, 0) / conAjuste.length,
      ultimo: filas[filas.length - 1],
      puntos: conAjuste
    };
  }

  // --- gráfico -------------------------------------------------------------

  const grafico = crearGrafico({
    svg: document.getElementById('grafico-svg'),
    tooltip: document.getElementById('grafico-tooltip'),
    formatoValor: (v) => `$${fAjustado.format(v)}`,
    formatoEje: (v) => fEje.format(v)
  });

  function dibujarGrafico(filas) {
    const datos = filas.filter((d) => d.ajustado !== null);
    grafico.dibujar(datos.map((d) => ({
      t: Date.UTC(d.anio, d.mes - 1, d.dia),
      valor: d.ajustado,
      etiqueta: fechaCorta(d)
    })));

    if (datos.length < 2) {
      texto('grafico-resumen', 'No hay suficientes datos para graficar este período.');
      return;
    }

    const resumen = resumir(datos);
    texto(
      'grafico-resumen',
      `${datos.length} días entre ${fechaCorta(datos[0])} y ${fechaCorta(datos[datos.length - 1])}. ` +
      `Máximo $${fAjustado.format(resumen.maximo.ajustado)} el ${fechaCorta(resumen.maximo)}; ` +
      `mínimo $${fAjustado.format(resumen.minimo.ajustado)} el ${fechaCorta(resumen.minimo)}. ` +
      `Los valores día por día están en la tabla de abajo.`
    );
  }

  // --- tabla y filtros -----------------------------------------------------

  const selectAnio = document.getElementById('filtro-anio');
  const selectOrden = document.getElementById('orden');
  const cuerpo = document.querySelector('#tabla-dolar tbody');
  const conteo = document.getElementById('conteo');

  const anios = [...new Set(serie.map((d) => d.anio))].sort((a, b) => b - a);
  selectAnio.add(new Option('todos', 'todos'));
  anios.forEach((anio) => selectAnio.add(new Option(String(anio), String(anio))));

  function render() {
    const anio = selectAnio.value;
    const filas = anio === 'todos' ? serie : serie.filter((d) => String(d.anio) === anio);

    const resumen = resumir(filas);
    if (resumen) {
      texto('stat-ultimo', `$${fNominal.format(resumen.ultimo.valor)} · ${fechaCorta(resumen.ultimo)}`);
      texto('stat-max', `$${fAjustado.format(resumen.maximo.ajustado)} · ${fechaCorta(resumen.maximo)}`);
      texto('stat-min', `$${fAjustado.format(resumen.minimo.ajustado)} · ${fechaCorta(resumen.minimo)}`);
      texto('stat-promedio', `$${fAjustado.format(resumen.promedio)}`);
    }

    dibujarGrafico(filas);

    const ordenadas = selectOrden.value === 'desc' ? filas.slice().reverse() : filas;
    cuerpo.innerHTML = ordenadas
      .map((d) =>
        '<tr><td>' + fechaCorta(d) +
        '</td><td>' + fNominal.format(d.valor) +
        '</td><td>' + (d.ajustado === null ? '—' : fAjustado.format(d.ajustado)) +
        '</td></tr>'
      )
      .join('');

    conteo.textContent = filas.length === 1 ? '1 día' : `${filas.length} días`;
  }

  selectAnio.addEventListener('change', render);
  selectOrden.addEventListener('change', render);
  render();
})();
