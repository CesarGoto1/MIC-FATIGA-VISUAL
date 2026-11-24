const ETIQUETAS_KSS = {
  1: "Extremadamente alerta",
  2: "Muy alerta",
  3: "Alerta",
  4: "Bastante alerta",
  5: "Ni alerta ni somnoliento",
  6: "Algunos signos de somnolencia",
  7: "Somnoliento, pero sin esfuerzo para mantenerme despierto",
  8: "Somnoliento, con algo de esfuerzo para mantenerme despierto",
  9: "Muy somnoliento, luchando contra el sueño",
};

function pintarEscala(contenedor) {
  const nombre = contenedor.dataset.nombreKss;
  contenedor.innerHTML = Object.entries(ETIQUETAS_KSS)
    .map(
      ([valor, etiqueta]) => `
      <label class="kss__opcion" style="--kss: ${(valor - 1) / 8}">
        <input type="radio" name="${nombre}" value="${valor}" required />
        <span class="kss__num">${valor}</span>
        <span class="kss__texto">${etiqueta}</span>
      </label>`
    )
    .join("");
}

export function kssElegido(contenedor) {
  const marcado = contenedor.querySelector("input:checked");
  return marcado ? Number(marcado.value) : null;
}

document.querySelectorAll(".kss").forEach(pintarEscala);
