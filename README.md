# Sistema inteligente de monitoreo visual para el control de la fatiga ocular

Prototipo reescrito desde cero, siguiendo la arquitectura definida en
`Requerimientos_Arquitectura.docx` (ver capa Cliente / Backend / Base de
datos / Diagnóstico IA).

## Estructura del proyecto

```
eyecare/
├── backend/
│   ├── main.py           # Punto de entrada de FastAPI
│   ├── config.py         # Lectura de variables de entorno (.env)
│   ├── database.py       # Pool de conexiones a PostgreSQL
│   ├── security.py       # Hashing de contraseñas (bcrypt) + JWT
│   ├── dependencies.py   # Dependencia get_current_user (auth por token)
│   ├── models/
│   │   └── schemas.py    # Modelos Pydantic (request/response)
│   └── routers/
│       ├── auth.py       # POST /auth/register, POST /auth/login
│       ├── sessions.py   # POST /sessions, POST /sessions/{id}/metrics
│       └── users.py      # GET /users/me, GET /users/me/history
├── frontend/
│   ├── templates/        # HTML servido por FastAPI (Jinja2)
│   └── static/
│       ├── css/
│       └── js/
│           ├── api.js         # Wrapper de fetch con el token JWT
│           ├── auth.js        # Lógica de login/registro
│           └── monitoreo.js   # Captura webcam + MediaPipe + cálculo EAR/PERCLOS
├── SQL/
│   └── schema.sql        # Esquema corregido (sin el bug "etapa"/"actividad")
├── tests/
│   └── test_auth.py      # Pruebas básicas con pytest
├── docker-compose.yml     # Levanta PostgreSQL local con un comando
├── requirements.txt
├── .env.example
└── Procfile               # Para despliegue posterior (Render u otro)
```

## Principio de diseño clave (RNF01, Privacidad por diseño)

El navegador (MediaPipe FaceMesh, en `monitoreo.js`) calcula EAR, PERCLOS
y frecuencia de parpadeo **en el cliente**. El backend nunca recibe video
ni imágenes — solo números (`POST /sessions/{id}/metrics`). Mantén esta
separación al implementar el resto de la lógica.

## Puesta en marcha local

### 1. Base de datos

```bash
docker compose up -d db
```

Esto levanta PostgreSQL en `localhost:5432` y ejecuta automáticamente
`SQL/schema.sql` la primera vez (vía el volumen de inicialización de la
imagen oficial de Postgres).

### 2. Variables de entorno

```bash
cp .env.example .env
```

Ajusta `JWT_SECRET` por un valor propio (cualquier cadena larga aleatoria
sirve para desarrollo local).

### 3. Entorno virtual y dependencias

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Levantar el backend

```bash
uvicorn backend.main:app --reload --port 8000
```

Abre `http://localhost:8000`.

### 5. (Opcional) Pruebas

```bash
pip install pytest httpx
pytest
```

## Qué falta implementar (deliberadamente dejado como TODO)

Este es un esqueleto funcional, no el sistema completo. Los puntos
marcados con `# TODO` en el código son el trabajo que corresponde a los
objetivos específicos 2 y 3 de tu perfil aprobado:

- `frontend/static/js/monitoreo.js`: integración real de MediaPipe
  FaceMesh (cargar el modelo, obtener los 6 landmarks por ojo, calcular
  EAR con la fórmula estándar) y la lógica de línea base adaptativa
  (AEAR, según Gupta et al. 2023).
- `backend/routers/sessions.py`: lógica de clasificación de fatiga
  (umbrales sobre PERCLOS/parpadeo) antes de guardar la métrica.
- Integración con n8n/Gemini para el diagnóstico narrativo asíncrono
  (RF09, RNF05) — el endpoint está preparado para recibirlo como un paso
  posterior y no bloqueante, pero la llamada en sí no está implementada.
