import {
  DERIVA_MAXIMA_LINEA_BASE,
  TRAMO_MINIMO_LINEA_BASE_MS,
  ACTUALIZACION_LINEA_BASE_MS,
  VENTANA_LINEA_BASE_MS,
  PROPORCION_CIERRE,
  PROPORCION_APERTURA,
  DURACION_CALIBRACION_MS,
  ESPERA_CALIBRACION_CIERRE_MS,
  PROPORCION_PISO_RESPALDO,
  PARPADEOS_COMPLETOS_REQUERIDOS,
  PARPADEO_VOLUNTARIO_MAXIMO_MS,
  MUESTRAS_MINIMAS_CALIBRACION,
  CIERRE_MINIMO_MS,
  APERTURA_P80,
  CUADROS_SUAVIZADO,
} from "./parametros.js";
import { mediana } from "./ocular.js";

export function crearCalibracion({ alProgresar, alFijarLineaBase, alTerminar, alActualizarUmbrales }) {
  let earBase = null;
  let basesPorOjo = null;
  let basesCalibradas = null;
  let muestrasCalibracion = [];
  let inicioCalibracion = null;
  let senalReciente = [];
  let historialOjos = [];
  let ultimaActualizacionBase = 0;
  let earCierreCompleto = null;
  let calibracionCierre = null;

  function fijarBasesPorOjo(bases) {
    basesPorOjo = { ...bases };
    earBase = (basesPorOjo.derecho + basesPorOjo.izquierdo) / 2;
  }

  function pisoOjoCerrado() {
    return earCierreCompleto ?? earBase * PROPORCION_PISO_RESPALDO;
  }

  function umbralP80() {
    const piso = pisoOjoCerrado();
    return piso + APERTURA_P80 * (earBase - piso);
  }

  function umbrales() {
    return { umbralParpadeo: earBase * PROPORCION_CIERRE, umbralP80: umbralP80() };
  }

  function calibrarLineaBase(earDerecho, earIzquierdo, ahora) {
    if (inicioCalibracion === null) inicioCalibracion = ahora;
    muestrasCalibracion.push({ derecho: earDerecho, izquierdo: earIzquierdo });

    const progreso = Math.min(1, (ahora - inicioCalibracion) / DURACION_CALIBRACION_MS);
    alProgresar(progreso);

    if (progreso >= 1 && muestrasCalibracion.length >= MUESTRAS_MINIMAS_CALIBRACION) {
      basesCalibradas = {
        derecho: mediana(muestrasCalibracion.map((c) => c.derecho)),
        izquierdo: mediana(muestrasCalibracion.map((c) => c.izquierdo)),
      };
      fijarBasesPorOjo(basesCalibradas);
      console.info(`Línea base de EAR (der. ${basesPorOjo.derecho.toFixed(3)}, izq. ${basesPorOjo.izquierdo.toFixed(3)})`);
      alFijarLineaBase();
    }
  }

  function calibrarCierre(ear, ahora) {
    const c = (calibracionCierre ??= { inicio: ahora, cerrado: false, desde: 0, minimo: 0, minimos: [] });

    if (!c.cerrado && ear < earBase * PROPORCION_CIERRE) {
      Object.assign(c, { cerrado: true, desde: ahora, minimo: ear });
    } else if (c.cerrado) {
      c.minimo = Math.min(c.minimo, ear);
      if (ear > earBase * PROPORCION_APERTURA) {
        c.cerrado = false;
        const duracion = ahora - c.desde;
        if (duracion >= CIERRE_MINIMO_MS && duracion <= PARPADEO_VOLUNTARIO_MAXIMO_MS) c.minimos.push(c.minimo);
        alProgresar(Math.min(1, c.minimos.length / PARPADEOS_COMPLETOS_REQUERIDOS));
      }
    }

    if (c.minimos.length >= PARPADEOS_COMPLETOS_REQUERIDOS) {
      earCierreCompleto = Math.min(mediana(c.minimos), earBase * (PROPORCION_CIERRE - 0.15));
      console.info(`EAR de cierre completo (mediana): ${earCierreCompleto.toFixed(3)}`);
      alTerminar(umbrales());
    } else if (ahora - c.inicio > ESPERA_CALIBRACION_CIERRE_MS) {
      earCierreCompleto = earBase * PROPORCION_PISO_RESPALDO;
      console.warn("No se detectaron los parpadeos de calibración; se usa el piso de respaldo.");
      alTerminar(umbrales());
    }
  }

  function senalBilateral(earDerecho, earIzquierdo) {
    const apertura = Math.max(earDerecho / basesPorOjo.derecho, earIzquierdo / basesPorOjo.izquierdo);
    senalReciente.push(apertura * earBase);
    if (senalReciente.length > CUADROS_SUAVIZADO) senalReciente.shift();
    return mediana(senalReciente);
  }

  function seguirLineaBase(earDerecho, earIzquierdo, ahora) {
    historialOjos.push({ t: ahora, derecho: earDerecho, izquierdo: earIzquierdo });
    while (historialOjos.length && historialOjos[0].t < ahora - VENTANA_LINEA_BASE_MS) historialOjos.shift();
    if (ahora - ultimaActualizacionBase < ACTUALIZACION_LINEA_BASE_MS) return;
    if (historialOjos.length < 2 || ahora - historialOjos[0].t < TRAMO_MINIMO_LINEA_BASE_MS) return;
    ultimaActualizacionBase = ahora;

    const acotar = (valor, referencia) =>
      Math.min(referencia * (1 + DERIVA_MAXIMA_LINEA_BASE), Math.max(referencia * (1 - DERIVA_MAXIMA_LINEA_BASE), valor));
    fijarBasesPorOjo({
      derecho: acotar(mediana(historialOjos.map((e) => e.derecho)), basesCalibradas.derecho),
      izquierdo: acotar(mediana(historialOjos.map((e) => e.izquierdo)), basesCalibradas.izquierdo),
    });
    alActualizarUmbrales(umbrales());
  }

  return {
    calibrarLineaBase,
    calibrarCierre,
    senalBilateral,
    seguirLineaBase,
    umbralP80,
    pisoOjoCerrado,
    get earBase() {
      return earBase;
    },
    get tieneLineaBase() {
      return earBase !== null;
    },
    get completa() {
      return earCierreCompleto !== null;
    },
  };
}
