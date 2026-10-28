from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.orm import Usuario
from backend.models.schemas import LoginRequest, RegisterRequest, TokenResponse
from backend.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_response(usuario: Usuario) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(usuario.id),
        usuario_id=usuario.id,
        nombre=usuario.nombre,
        codigo_participante=usuario.codigo,
        es_admin=usuario.es_admin,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    existe = db.query(Usuario).filter(Usuario.email == data.email).first()
    if existe is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una cuenta registrada con ese correo.",
        )

    usuario = Usuario(
        nombre=data.nombre,
        email=data.email,
        password_hash=hash_password(data.password),
    )
    db.add(usuario)
    db.flush()

    return _token_response(usuario)


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Correo o contraseña incorrectos.",
    )

    usuario = db.query(Usuario).filter(Usuario.email == data.email).first()
    if usuario is None:
        raise credenciales_invalidas
    if not verify_password(data.password, usuario.password_hash):
        raise credenciales_invalidas

    return _token_response(usuario)
