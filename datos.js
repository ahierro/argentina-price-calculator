/* Lectura de los CSV en tiempo de ejecución.
   No hay paso de build ni datos copiados a mano: las páginas leen
   inflacionmensual.csv y tipo_de_cambio.csv tal como están en el disco, así que
   cambiar un CSV alcanza para que la página cambie con él. */

window.Datos = (function () {
  'use strict';

  async function leer(ruta) {
    let respuesta;
    try {
      // Sin caché: si no, el navegador puede seguir mostrando un CSV viejo.
      respuesta = await fetch(ruta, { cache: 'no-store' });
    } catch (error) {
      throw new Error(
        `No se pudo leer ${ruta}. Si abriste el archivo directamente con file://, ` +
        `hace falta servir la carpeta (por ejemplo: npx serve).`
      );
    }
    if (!respuesta.ok) throw new Error(`No se pudo leer ${ruta} (HTTP ${respuesta.status}).`);
    return respuesta.text();
  }

  function renglones(csv) {
    return csv
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter(Boolean);
  }

  function partir(linea, ruta, numero) {
    const [fecha, valor] = linea.split(';');
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha || '');
    if (!m) throw new Error(`${ruta}, línea ${numero}: fecha inválida (${linea}).`);
    const numerico = Number(valor);
    if (!Number.isFinite(numerico)) {
      throw new Error(`${ruta}, línea ${numero}: valor inválido (${linea}).`);
    }
    return { anio: Number(m[3]), mes: Number(m[2]), dia: Number(m[1]), valor: numerico };
  }

  /* Serie mensual de variaciones porcentuales, encadenada en un índice. La usan
     tanto el IPC (inflacionmensual.csv) como la devaluación
     (devaluacion_mensual.csv): la cuenta es la misma, cambia el archivo. Cada
     fila del CSV lleva la fecha del último día del mes al que corresponde la
     variación.

     Con n variaciones se encadenan n+1 niveles, porque una variación es el paso
     entre dos meses. Los niveles se expresan a valores de comienzo de mes: el
     nivel de un mes es el anterior a aplicar su propia variación, que es lo que
     significa elegir "julio de 2026" en la calculadora. El último mes de la
     lista todavía no tiene variación propia. */
  async function variaciones(archivo) {
    const meses = renglones(await leer(archivo))
      .map((linea, i) => partir(linea, archivo, i + 1))
      .map((f) => ({ anio: f.anio, mes: f.mes, variacion: f.valor }))
      .sort((a, b) => a.anio - b.anio || a.mes - b.mes);

    if (meses.length === 0) throw new Error(`${archivo} no tiene datos.`);
    return meses;
  }

  function encadenar(meses, origen) {
    // El encadenado supone meses consecutivos: un hueco daría un índice mal armado.
    for (let i = 1; i < meses.length; i++) {
      const anterior = meses[i - 1].anio * 12 + (meses[i - 1].mes - 1);
      if (meses[i].anio * 12 + (meses[i].mes - 1) !== anterior + 1) {
        throw new Error(
          `${origen}: faltan meses entre ${meses[i - 1].mes}/${meses[i - 1].anio} ` +
          `y ${meses[i].mes}/${meses[i].anio}.`
        );
      }
    }

    let nivel = 100;
    const puntos = [];
    for (const m of meses) {
      puntos.push({ anio: m.anio, mes: m.mes, variacion: m.variacion, indice: nivel });
      nivel *= 1 + m.variacion / 100;
    }

    const ultimo = meses[meses.length - 1];
    puntos.push({
      anio: ultimo.mes === 12 ? ultimo.anio + 1 : ultimo.anio,
      mes: ultimo.mes === 12 ? 1 : ultimo.mes + 1,
      variacion: null,
      indice: nivel
    });

    return puntos;
  }

  async function serieMensual(ruta) {
    const archivo = ruta || 'inflacionmensual.csv';
    return encadenar(await variaciones(archivo), archivo);
  }

  /* Inflación medida en dólares: cuánto se movieron los precios argentinos una
     vez descontado lo que se movió el dólar.

     Es un cociente, no una resta. Si los precios suben 25% y el dólar sube
     124%, en dólares los precios NO bajaron 99% (25 - 124): bajaron 44%,
     porque 1,25 / 2,24 = 0,56. La resta solo se le parece cuando los dos
     números son chicos, y en esta serie no lo son. */
  async function serieEnDolares(rutaPrecios, rutaDolar) {
    const archivoPrecios = rutaPrecios || 'inflacionmensual.csv';
    const archivoDolar = rutaDolar || 'devaluacion_mensual.csv';
    const [precios, dolar] = await Promise.all([
      variaciones(archivoPrecios), variaciones(archivoDolar)
    ]);

    const porClave = new Map(dolar.map((d) => [d.anio * 12 + (d.mes - 1), d.variacion]));
    const combinados = [];
    for (const p of precios) {
      const devaluacion = porClave.get(p.anio * 12 + (p.mes - 1));
      if (devaluacion === undefined) continue; // mes sin las dos puntas
      if (devaluacion <= -100) {
        throw new Error(`${archivoDolar}: devaluación imposible en ${p.mes}/${p.anio}.`);
      }
      combinados.push({
        anio: p.anio,
        mes: p.mes,
        variacion: ((1 + p.variacion / 100) / (1 + devaluacion / 100) - 1) * 100
      });
    }

    if (combinados.length === 0) {
      throw new Error(
        `${archivoPrecios} y ${archivoDolar} no tienen ningún mes en común.`
      );
    }

    return encadenar(combinados, `${archivoPrecios} + ${archivoDolar}`);
  }

  /* Tipo de cambio diario. Devuelve las cotizaciones y la lista de duplicados
     descartados, para que la página pueda avisar en vez de callarse. */
  async function tipoDeCambio(ruta) {
    const archivo = ruta || 'tipo_de_cambio.csv';
    const filas = renglones(await leer(archivo))
      .map((linea, i) => partir(linea, archivo, i + 1))
      .sort((a, b) => a.anio - b.anio || a.mes - b.mes || a.dia - b.dia);

    if (filas.length === 0) throw new Error(`${archivo} no tiene datos.`);

    // El CSV trae alguna fecha repetida con dos cotizaciones distintas: se
    // conserva la primera.
    const vistas = new Map();
    const cotizaciones = [];
    const duplicados = [];
    for (const f of filas) {
      const clave = `${f.anio}-${f.mes}-${f.dia}`;
      if (vistas.has(clave)) {
        duplicados.push({ ...f, conservado: vistas.get(clave) });
        continue;
      }
      vistas.set(clave, f.valor);
      cotizaciones.push(f);
    }

    return { cotizaciones, duplicados };
  }

  return { serieMensual, serieEnDolares, tipoDeCambio };
})();
