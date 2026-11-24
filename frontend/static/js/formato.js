export const NIVEL_ETIQUETA = { sin_fatiga: "Sin fatiga", leve: "Fatiga visual leve", moderada: "Fatiga visual moderada" };
export const NIVEL_CLASE = { sin_fatiga: "insignia--exito", leve: "insignia--leve", moderada: "insignia--moderada" };
export const MOMENTO_ETIQUETA = { pre: "Antes de la jornada", post: "Después de la jornada" };
export const ACTIVIDAD_ETIQUETA = { lectura: "Lectura PDF", video: "Video", libre: "Solo monitoreo" };

export const formatoFecha = new Intl.DateTimeFormat("es-EC", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function fecha(iso) {
  return iso ? formatoFecha.format(new Date(iso)) : "–";
}

export function numero(valor, decimales) {
  return valor === null || valor === undefined ? "–" : Number(valor).toFixed(decimales);
}

export function promedio(valores) {
  const presentes = valores.filter((v) => v !== null && v !== undefined);
  return presentes.length ? presentes.reduce((a, b) => a + b, 0) / presentes.length : null;
}

export function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

export function htmlCargando(texto, etiqueta = "span") {
  return `<${etiqueta} class="analisis-estado__texto"><span class="cargando" aria-hidden="true"></span>${texto}</${etiqueta}>`;
}

export function alActivar(elemento, accion) {
  elemento.addEventListener("click", accion);
  elemento.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    accion();
  });
}
