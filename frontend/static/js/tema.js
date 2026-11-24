const raiz = document.documentElement;

function leerTemaGuardado() {
  try {
    return localStorage.getItem("tema");
  } catch {
    return null;
  }
}

function guardarTema(tema) {
  try {
    localStorage.setItem("tema", tema);
  } catch (err) {
    console.warn("No se pudo recordar el tema:", err.message);
  }
}

function aplicarTema(tema) {
  if (tema) raiz.dataset.tema = tema;
  else delete raiz.dataset.tema;
}

function temaActual() {
  return raiz.dataset.tema || (matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro");
}

aplicarTema(leerTemaGuardado());

document.querySelectorAll(".cambio-tema").forEach((boton) => {
  boton.addEventListener("click", () => {
    const siguiente = temaActual() === "oscuro" ? "claro" : "oscuro";
    aplicarTema(siguiente);
    guardarTema(siguiente);
  });
});
