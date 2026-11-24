const visorPdf = document.getElementById("visor-pdf");
const visorVideo = document.getElementById("visor-video");
const visorYoutube = document.getElementById("visor-youtube");
const visorVacio = document.getElementById("visor-vacio");

let urlContenido = null;

function urlYoutube(id) {
  const parametros = new URLSearchParams({
    enablejsapi: "1",
    rel: "0",
    playsinline: "1",
    origin: window.location.origin,
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${parametros}`;
}

export function mostrarContenido(actividad, archivo, youtube) {
  visorPdf.hidden = true;
  visorVideo.hidden = true;
  visorYoutube.hidden = true;
  visorVacio.hidden = true;

  if (actividad === "video" && youtube) {
    visorYoutube.src = urlYoutube(youtube);
    visorYoutube.hidden = false;
    return;
  }
  if (actividad === "libre" || !archivo) {
    visorVacio.hidden = false;
    return;
  }
  urlContenido = URL.createObjectURL(archivo);
  const visor = actividad === "lectura" ? visorPdf : visorVideo;
  visor.src = urlContenido;
  visor.hidden = false;
}

export function pausarVideo() {
  if (!visorVideo.hidden) visorVideo.pause();
  if (!visorYoutube.hidden && visorYoutube.contentWindow) {
    visorYoutube.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
      "*",
    );
  }
}

export function liberarContenido() {
  visorVideo.pause();
  visorVideo.removeAttribute("src");
  visorPdf.removeAttribute("src");
  visorYoutube.removeAttribute("src");
  if (urlContenido) URL.revokeObjectURL(urlContenido);
  urlContenido = null;
}
