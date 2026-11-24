import { crearCalibracion } from "./calibracion.js";
import { OJO_IZQUIERDO, OJO_DERECHO, desplazamientoMedioIris, proporcionAspectoOjo } from "./ocular.js";
import { crearVentana } from "./ventana.js";

export function crearDetector(eventos) {
  const calibracion = crearCalibracion(eventos);
  const ventana = crearVentana();

  function procesar(puntos, ahora, { escucharOjo, pausado }) {
    const earDerecho = proporcionAspectoOjo(puntos, OJO_DERECHO);
    const earIzquierdo = proporcionAspectoOjo(puntos, OJO_IZQUIERDO);
    const ear = (earDerecho + earIzquierdo) / 2;

    if (!calibracion.tieneLineaBase) {
      calibracion.calibrarLineaBase(earDerecho, earIzquierdo, ahora);
      return null;
    }
    const senal = calibracion.senalBilateral(earDerecho, earIzquierdo);
    if (!calibracion.completa) {
      calibracion.calibrarCierre(senal, ahora);
      return null;
    }
    if (escucharOjo) {
      escucharOjo(senal, ahora);
      return null;
    }
    if (pausado) {
      ventana.soltarSeguimiento();
      return null;
    }

    const dt = ventana.avanzar(ahora);
    calibracion.seguirLineaBase(earDerecho, earIzquierdo, ahora);
    ventana.detectarParpadeo(senal, ahora, calibracion);
    ventana.agregarMuestra({ t: ahora, dt, ear, p80: senal <= calibracion.umbralP80() });
    eventos.alMedirSenal(ahora, senal);
    ventana.registrarIris(desplazamientoMedioIris(puntos), ahora, dt);
    ventana.podar(ahora);
    return ear;
  }

  return {
    procesar,
    perderRostro: ventana.soltarSeguimiento,
    reiniciarVentana: ventana.reiniciar,
    calcularMetricas: ventana.calcularMetricas,
    marcarEnviado: ventana.marcarEnviado,
    get ultimoEnvio() {
      return ventana.ultimoEnvio;
    },
    get tieneLineaBase() {
      return calibracion.tieneLineaBase;
    },
    umbralesOjo() {
      return { earBase: calibracion.earBase, pisoOjoCerrado: calibracion.pisoOjoCerrado() };
    },
  };
}
