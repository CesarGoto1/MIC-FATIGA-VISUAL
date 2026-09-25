const authView = document.getElementById("auth-view");
const dashboardView = document.getElementById("dashboard-view");
const monitoreoView = document.getElementById("monitoreo-view");

function showAuthView() {
  authView.hidden = false;
  dashboardView.hidden = true;
  monitoreoView.hidden = true;
}

function showDashboardView() {
  authView.hidden = true;
  monitoreoView.hidden = true;
  dashboardView.hidden = false;

  document.getElementById("dash-usuario-nombre").textContent = localStorage.getItem("usuario_nombre") || "";

  if (typeof refreshDashboard === "function") refreshDashboard();
}

function showMonitoreoView() {
  authView.hidden = true;
  dashboardView.hidden = true;
  monitoreoView.hidden = false;

  if (typeof resetMonitoreo === "function") resetMonitoreo();
}

// ---------- Tema claro / oscuro ----------
// Sin preferencia guardada se respeta la del sistema operativo.

function readStoredTheme() {
  try {
    return localStorage.getItem("tema");
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function currentTheme() {
  const stored = document.documentElement.dataset.theme;
  if (stored) return stored;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

applyTheme(readStoredTheme());

document.querySelectorAll(".theme-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("tema", next);
    } catch {
      /* sin almacenamiento: el cambio dura solo esta visita */
    }
  });
});

// ---------- Karolinska Sleepiness Scale ----------
// Åkerstedt y Gillberg (1990). Las etiquetas pares son puntos intermedios.

const KSS_ETIQUETAS = {
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

function renderKss(container) {
  const name = container.dataset.kssName;
  container.innerHTML = Object.entries(KSS_ETIQUETAS)
    .map(
      ([valor, etiqueta]) => `
      <label class="kss__option" style="--kss: ${(valor - 1) / 8}">
        <input type="radio" name="${name}" value="${valor}" required />
        <span class="kss__num">${valor}</span>
        <span class="kss__text">${etiqueta}</span>
      </label>`
    )
    .join("");
}

function selectedKss(container) {
  const checked = container.querySelector("input:checked");
  return checked ? Number(checked.value) : null;
}

document.querySelectorAll(".kss").forEach(renderKss);
