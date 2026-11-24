import { subirBinario } from "../api.js";

const TIPOS = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1", "video/mp4"];
const TROZO_MS = 5_000;
const REINTENTOS = 3;
const BITS_POR_SEGUNDO = 1_000_000;

function tipoSoportado() {
  return TIPOS.find((tipo) => MediaRecorder.isTypeSupported(tipo)) ?? "";
}

export function grabacionDisponible() {
  return typeof MediaRecorder !== "undefined";
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export function crearGrabador({ sesionId, flujo, origen, alFallar }) {
  const tipo = tipoSoportado();
  const grabadora = new MediaRecorder(flujo, {
    ...(tipo && { mimeType: tipo }),
    videoBitsPerSecond: BITS_POR_SEGUNDO,
  });
  let desfaseMs = 0;
  let siguienteParte = 0;
  let cola = Promise.resolve();
  let detenido = false;

  function enviar(trozo, parte) {
    const parametros = new URLSearchParams({
      desfase_ms: desfaseMs,
      tipo_mime: grabadora.mimeType || tipo || "video/webm",
    });
    return subirBinario(`/sesiones/${sesionId}/grabacion/partes/${parte}?${parametros}`, trozo);
  }

  async function subir(trozo, parte) {
    for (let intento = 1; ; intento += 1) {
      try {
        return await enviar(trozo, parte);
      } catch (err) {
        const definitivo = err.estado !== undefined && err.estado < 500;
        if (definitivo || intento >= REINTENTOS) throw err;
        await esperar(1_000 * intento);
      }
    }
  }

  grabadora.addEventListener("start", () => {
    desfaseMs = Math.max(0, Math.round(performance.now() - origen));
  });

  grabadora.addEventListener("dataavailable", (e) => {
    if (detenido || e.data.size === 0) return;
    const parte = siguienteParte;
    siguienteParte += 1;
    cola = cola
      .then(() => (detenido ? null : subir(e.data, parte)))
      .catch((err) => {
        detenido = true;
        alFallar?.(err);
      });
  });

  function parar() {
    if (grabadora.state === "inactive") return Promise.resolve();
    return new Promise((resolver) => {
      grabadora.addEventListener("stop", resolver, { once: true });
      grabadora.stop();
    });
  }

  return {
    iniciar() {
      grabadora.start(TROZO_MS);
    },
    async detener() {
      await parar();
      await cola;
    },
    cancelar() {
      detenido = true;
      if (grabadora.state !== "inactive") grabadora.stop();
    },
  };
}
