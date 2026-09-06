from fastapi import APIRouter, HTTPException, status

from backend.database import get_connection
from backend.models.schemas import LoginRequest, RegisterRequest, TokenResponse
from backend.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest):
    password_hash = hash_password(data.password)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM usuarios WHERE email = %s", (data.email,))
            if cur.fetchone() is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Ya existe una cuenta registrada con ese correo.",
                )

            cur.execute(
                """
                INSERT INTO usuarios (nombre, email, password_hash)
                VALUES (%s, %s, %s)
                RETURNING id, nombre
                """,
                (data.nombre, data.email, password_hash),
            )
            usuario_id, nombre = cur.fetchone()

    token = create_access_token(usuario_id)
    return TokenResponse(access_token=token, usuario_id=usuario_id, nombre=nombre)


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, nombre, password_hash FROM usuarios WHERE email = %s",
                (data.email,),
            )
            row = cur.fetchone()

    # Mensaje idéntico para "no existe" y "contraseña incorrecta": no revelar
    # cuál de las dos cosas falló (evita enumeración de correos registrados).
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Correo o contraseña incorrectos.",
    )

    if row is None:
        raise credenciales_invalidas

    usuario_id, nombre, password_hash = row
    if not verify_password(data.password, password_hash):
        raise credenciales_invalidas

    token = create_access_token(usuario_id)
    return TokenResponse(access_token=token, usuario_id=usuario_id, nombre=nombre)
