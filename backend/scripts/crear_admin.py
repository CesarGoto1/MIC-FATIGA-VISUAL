import argparse
import sys

from backend.database import SessionLocal
from backend.models.orm import Usuario


def promover(email: str) -> bool:
    db = SessionLocal()
    try:
        usuario = db.query(Usuario).filter(Usuario.email == email).first()
        if usuario is None:
            return False
        usuario.es_admin = True
        db.commit()
        return True
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Promueve un usuario existente a administrador.")
    parser.add_argument("email", help="Correo de la cuenta ya registrada")
    args = parser.parse_args()

    if not promover(args.email):
        print(f"No existe ninguna cuenta con el correo {args.email}.", file=sys.stderr)
        sys.exit(1)
    print(f"La cuenta {args.email} ahora es administradora.")


if __name__ == "__main__":
    main()
