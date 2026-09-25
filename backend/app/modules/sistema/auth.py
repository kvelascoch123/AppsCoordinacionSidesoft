"""
Autenticación con las credenciales de GLPI (glpi_users, hash bcrypt `$2y$`).

- Sin almacén de contraseñas propio: la identidad y los perfiles se leen de GLPI.
- Sesión en cookie HttpOnly + SameSite=Strict firmada (JWT HS256) con expiración.
- Si DASHBOARD_ALLOWED_LOGINS está definido, solo esos usuarios ingresan (rol «admin»). Si no, rol «admin»
  con algún perfil de DASHBOARD_ADMIN_PROFILES y «user» con alguno de DASHBOARD_ALLOWED_PROFILES.
- Sesión deslizante (DASHBOARD_SESSION_HOURS, 180 días por defecto): la cookie se renueva una vez al día con el
  uso, así el usuario inicia sesión una sola vez.
- /api/survey/* es público (encuesta), protegido por enlaces firmados.
- Las peticiones que modifican estado deben traer la cabecera X-Requested-With (mitiga CSRF:
  un formulario de otro sitio no puede añadir cabeceras y el CORS del API no lo permite).
- Límite de intentos fallidos por IP + usuario.
"""

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Deque, Dict, List, Optional, Tuple

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from app.db import fetch_all, fetch_one
from app.modules.soporte.config import get_settings

SESSION_COOKIE = "coorddash_session"
CSRF_HEADER = "x-requested-with"
_JWT_ALG = "HS256"

# Rutas accesibles sin sesión.
PUBLIC_PATHS = {"/api/health", "/api/health/db", "/api/auth/login", "/api/auth/logout", "/api/auth/me"}
PUBLIC_PREFIXES = ("/api/survey/",)  # encuesta de satisfacción: pública, protegida por enlace firmado
RENEW_AFTER = timedelta(hours=24)  # sesión deslizante: se re-emite la cookie una vez al día con el uso


def is_public_path(path: str) -> bool:
    return path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES)


@dataclass(frozen=True)
class CurrentUser:
    id: int
    login: str
    full_name: str
    role: str  # "admin" | "user"
    profiles: Tuple[str, ...]

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def to_public(self) -> dict:
        return {
            "id": self.id,
            "login": self.login,
            "full_name": self.full_name,
            "role": self.role,
            "profiles": list(self.profiles),
        }


class AuthError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


# --------------------------------------------------------------------------- rate limit

_MAX_FAILS = 5
_WINDOW_S = 15 * 60
_fail_lock = threading.Lock()
_fails: Dict[str, Deque[float]] = defaultdict(deque)


def _rl_key(ip: str, login: str) -> str:
    return f"{ip}|{login.strip().lower()}"


def _rl_blocked(key: str) -> bool:
    now = time.monotonic()
    with _fail_lock:
        q = _fails[key]
        while q and now - q[0] > _WINDOW_S:
            q.popleft()
        return len(q) >= _MAX_FAILS


def _rl_fail(key: str) -> None:
    with _fail_lock:
        _fails[key].append(time.monotonic())


def _rl_reset(key: str) -> None:
    with _fail_lock:
        _fails.pop(key, None)


# --------------------------------------------------------------------------- GLPI

def _user_profiles(user_id: int) -> List[str]:
    rows = fetch_all(
        """
        SELECT DISTINCT p.name
        FROM glpi_profiles_users pu
        INNER JOIN glpi_profiles p ON p.id = pu.profiles_id
        WHERE pu.users_id = %s
        """,
        (user_id,),
    )
    return [str(r["name"]) for r in rows if r.get("name")]


def _role_for(profiles: List[str], login: str = "") -> Optional[str]:
    s = get_settings()
    if s.allowed_logins_list:
        # Lista blanca de usuarios: solo ellos ingresan y con acceso completo.
        return "admin" if login.lower() in s.allowed_logins_list else None
    lower = {p.lower() for p in profiles}
    if lower & {p.lower() for p in s.admin_profiles_list}:
        return "admin"
    if lower & {p.lower() for p in s.allowed_profiles_list}:
        return "user"
    return None


_ACTIVE_USER_SQL = """
    SELECT id, name, password, authtype,
           COALESCE(NULLIF(TRIM(CONCAT(COALESCE(firstname, ''), ' ', COALESCE(realname, ''))), ''), name) AS full_name
    FROM glpi_users
    WHERE {where}
      AND is_deleted = 0
      AND is_active = 1
      AND (begin_date IS NULL OR begin_date <= NOW())
      AND (end_date IS NULL OR end_date > NOW())
    LIMIT 1
"""


def _load_user(user_id: int) -> Optional[CurrentUser]:
    row = fetch_one(_ACTIVE_USER_SQL.format(where="id = %s"), (user_id,))
    if not row:
        return None
    profiles = _user_profiles(int(row["id"]))
    role = _role_for(profiles, str(row["name"]))
    if not role:
        return None
    return CurrentUser(int(row["id"]), str(row["name"]), str(row["full_name"]), role, tuple(profiles))


def _check_password(plain: str, stored: Optional[str]) -> bool:
    if not stored or not plain:
        return False
    h = stored.strip()
    if not h.startswith(("$2y$", "$2b$", "$2a$")):
        return False  # hashes legados (MD5/SHA1) no soportados: el usuario debe iniciar sesión una vez en GLPI
    if h.startswith("$2y$"):
        h = "$2b$" + h[4:]
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), h.encode("ascii"))
    except ValueError:
        return False


def authenticate(login: str, password: str, ip: str) -> CurrentUser:
    login = (login or "").strip()
    key = _rl_key(ip, login)
    if _rl_blocked(key):
        raise AuthError(429, "Demasiados intentos fallidos. Espere unos minutos e intente de nuevo.")
    row = fetch_one(_ACTIVE_USER_SQL.format(where="name = %s"), (login,)) if login else None
    # Siempre se evalúa bcrypt (con hash ficticio si no hay usuario) para no revelar por tiempo si existe.
    ok = _check_password(password, row.get("password") if row else _DUMMY_HASH)
    if not row or not ok:
        _rl_fail(key)
        raise AuthError(401, "Usuario o contraseña incorrectos.")
    profiles = _user_profiles(int(row["id"]))
    role = _role_for(profiles, str(row["name"]))
    if not role:
        _rl_fail(key)
        raise AuthError(403, "Su usuario de GLPI no tiene acceso a este panel.")
    _rl_reset(key)
    return CurrentUser(int(row["id"]), str(row["name"]), str(row["full_name"]), role, tuple(profiles))


_DUMMY_HASH = bcrypt.hashpw(b"dummy-password", bcrypt.gensalt(rounds=10)).decode()


# --------------------------------------------------------------------------- sesión

def _secret() -> str:
    secret = (get_settings().session_secret or "").strip()
    if len(secret) < 32:
        raise AuthError(
            500,
            "DASHBOARD_SESSION_SECRET no configurado (mínimo 32 caracteres). "
            "Genere uno con: python -c \"import secrets; print(secrets.token_urlsafe(48))\"",
        )
    return secret


def issue_token(user: CurrentUser) -> Tuple[str, int]:
    hours = max(1, int(get_settings().session_hours))
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.id), "iat": now, "exp": now + timedelta(hours=hours)}
    return jwt.encode(payload, _secret(), algorithm=_JWT_ALG), hours * 3600


def user_from_request(request: Request) -> Optional[CurrentUser]:
    """Usuario de la sesión (re-validado contra GLPI en cada petición) o None."""
    cached = getattr(request.state, "user", None)
    if cached is not None:
        return cached
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    try:
        payload = jwt.decode(token, _secret(), algorithms=[_JWT_ALG], options={"require": ["exp", "sub"]})
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None
    user = _load_user_cached(user_id)
    request.state.user = user
    iat = payload.get("iat")
    request.state.session_needs_renewal = bool(
        user and iat and datetime.now(timezone.utc) - datetime.fromtimestamp(int(iat), timezone.utc) > RENEW_AFTER
    )
    return user


# Pequeña caché (60 s) para no consultar perfiles en cada petición del tablero.
_user_cache: Dict[int, Tuple[float, Optional[CurrentUser]]] = {}
_user_cache_lock = threading.Lock()


def _load_user_cached(user_id: int) -> Optional[CurrentUser]:
    now = time.monotonic()
    with _user_cache_lock:
        hit = _user_cache.get(user_id)
        if hit and now - hit[0] < 60:
            return hit[1]
    user = _load_user(user_id)
    with _user_cache_lock:
        _user_cache[user_id] = (now, user)
    return user


def set_session_cookie(response, token: str, max_age: int) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="strict",
        path="/api",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/api", samesite="strict", secure=get_settings().cookie_secure)


# --------------------------------------------------------------------------- dependencias

def require_user(request: Request) -> CurrentUser:
    if not get_settings().auth_enabled:
        return CurrentUser(0, "anon", "Sin autenticación", "admin", ())
    try:
        user = user_from_request(request)
    except AuthError as e:
        raise HTTPException(status_code=e.status, detail=e.detail) from e
    if not user:
        raise HTTPException(status_code=401, detail="Sesión no válida o expirada.")
    return user


def require_admin(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Requiere perfil administrador.")
    return user
