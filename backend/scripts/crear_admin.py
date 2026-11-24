import argparse
import sys

from sqlalchemy import func, select

from backend.base_datos import crear_sesion_bd
from backend.modelos.orm import Usuario


def promover(correo: str) -> bool:
    with crear_sesion_bd() as bd:
        usuario = bd.scalar(select(Usuario).where(func.lower(Usuario.correo) == correo.strip().lower()))
        if usuario is None:
            return False
        usuario.es_admin = True
        bd.commit()
        return True


def main() -> None:
    analizador = argparse.ArgumentParser(description="Promueve un usuario existente a administrador.")
    analizador.add_argument("correo", help="Correo de la cuenta ya registrada")
    argumentos = analizador.parse_args()

    if not promover(argumentos.correo):
        print(f"No existe ninguna cuenta con el correo {argumentos.correo}.", file=sys.stderr)
        sys.exit(1)
    print(f"La cuenta {argumentos.correo} ahora es administradora.")


if __name__ == "__main__":
    main()
