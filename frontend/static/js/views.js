/**
 * Cambia entre las tres vistas de la app (login/registro, panel principal,
 * sesión de monitoreo). Centralizado aquí porque auth.js, dashboard.js y
 * monitoreo.js necesitan navegar entre ellas.
 */
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

  const nombre = localStorage.getItem("usuario_nombre") || "";
  document.getElementById("dash-usuario-nombre").textContent = nombre;
  document.getElementById("usuario-nombre").textContent = nombre;

  if (typeof refreshDashboard === "function") refreshDashboard();
}

function showMonitoreoView() {
  authView.hidden = true;
  dashboardView.hidden = true;
  monitoreoView.hidden = false;
}
