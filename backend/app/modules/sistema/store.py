"""Configuración clave/valor (JSON) y cifrado de secretos guardados en BD."""

import json
from typing import Any, Dict, Optional

from cryptography.fernet import Fernet, InvalidToken

from app.db import execute, fetch_one
from app.modules.soporte.config import get_settings
from app.modules.sistema.schema import T_SETTINGS

KEY_SMTP = "smtp"
KEY_REPORT_SCHEDULE = "report_schedule"
KEY_WORKER_HEARTBEAT = "worker_heartbeat"


class SecretKeyMissing(RuntimeError):
    pass


def get_setting(name: str) -> Optional[Dict[str, Any]]:
    row = fetch_one(f"SELECT value FROM `{T_SETTINGS}` WHERE name = %s", (name,))
    if not row or not row.get("value"):
        return None
    try:
        data = json.loads(row["value"])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def set_setting(name: str, value: Dict[str, Any], users_id: int = 0) -> None:
    execute(
        f"""
        INSERT INTO `{T_SETTINGS}` (name, value, users_id_mod, date_mod)
        VALUES (%s, %s, %s, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE value = VALUES(value), users_id_mod = VALUES(users_id_mod), date_mod = UTC_TIMESTAMP()
        """,
        (name, json.dumps(value, ensure_ascii=False, default=str), users_id),
    )


def _fernet() -> Fernet:
    key = (get_settings().encryption_key or "").strip()
    if not key:
        raise SecretKeyMissing(
            "Falta DASHBOARD_ENCRYPTION_KEY en .env (genere una con: "
            "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\")."
        )
    try:
        return Fernet(key.encode())
    except ValueError as e:
        raise SecretKeyMissing("DASHBOARD_ENCRYPTION_KEY no es una clave Fernet válida.") from e


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise SecretKeyMissing(
            "No se pudo descifrar el secreto guardado: DASHBOARD_ENCRYPTION_KEY cambió. Vuelva a ingresar la contraseña SMTP."
        ) from e
