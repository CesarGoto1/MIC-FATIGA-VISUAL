const authError = document.getElementById("auth-error");

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const loginSection = document.getElementById("login-section");
const registerSection = document.getElementById("register-section");
const authTabs = document.querySelector(".auth-tabs");
const authHeading = document.getElementById("auth-heading");
const authSubheading = document.getElementById("auth-subheading");

function showTab(tab) {
  const isLogin = tab === "login";
  tabLogin.classList.toggle("is-active", isLogin);
  tabRegister.classList.toggle("is-active", !isLogin);
  tabLogin.setAttribute("aria-selected", String(isLogin));
  tabRegister.setAttribute("aria-selected", String(!isLogin));
  loginSection.hidden = !isLogin;
  registerSection.hidden = isLogin;
  authTabs.dataset.active = isLogin ? "login" : "register";
  authHeading.textContent = isLogin ? "Bienvenido de nuevo" : "Crea tu cuenta";
  authSubheading.textContent = isLogin
    ? "Ingresa tus datos para continuar."
    : "Empieza a monitorear tu fatiga visual.";
  authError.hidden = true;
}

tabLogin.addEventListener("click", () => showTab("login"));
tabRegister.addEventListener("click", () => showTab("register"));

document.querySelectorAll(".auth-field__toggle").forEach((button) => {
  const input = document.getElementById(button.dataset.toggleFor);
  const eyeIcon = button.querySelector(".icon-eye");
  const eyeOffIcon = button.querySelector(".icon-eye-off");

  button.addEventListener("click", () => {
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    eyeIcon.hidden = !isVisible;
    eyeOffIcon.hidden = isVisible;
  });
});

function showError(message) {
  authError.textContent = message;
  authError.hidden = false;
}

async function submitWithLoadingState(form, label, action) {
  const button = form.querySelector(".auth-submit");
  const buttonLabel = button.querySelector(".auth-submit__label");
  const originalText = buttonLabel.textContent;

  button.disabled = true;
  buttonLabel.textContent = label;
  try {
    await action();
  } finally {
    button.disabled = false;
    buttonLabel.textContent = originalText;
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  await submitWithLoadingState(e.target, "Ingresando…", async () => {
    try {
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setSession(data.access_token, data.usuario_id, data.nombre);
      showDashboardView();
    } catch (err) {
      showError(err.message);
    }
  });
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  const nombre = document.getElementById("register-nombre").value;
  const email = document.getElementById("register-email").value;
  const password = document.getElementById("register-password").value;

  await submitWithLoadingState(e.target, "Creando cuenta…", async () => {
    try {
      const data = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ nombre, email, password }),
      });
      setSession(data.access_token, data.usuario_id, data.nombre);
      showDashboardView();
    } catch (err) {
      showError(err.message);
    }
  });
});

if (getToken()) {
  showDashboardView();
}
