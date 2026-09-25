"""Configuración SMTP (guardada en BD con contraseña cifrada) y envío de correos."""

import mimetypes
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

from pydantic import BaseModel, Field, field_validator

from app.db import fetch_all
from app.modules.sistema.store import KEY_SMTP, decrypt_secret, encrypt_secret, get_setting, set_setting

Security = Literal["none", "starttls", "ssl"]

mimetypes.add_type("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx")


class SmtpConfig(BaseModel):
    host: str = ""
    port: int = Field(default=587, ge=1, le=65535)
    security: Security = "starttls"
    username: str = ""
    from_email: str = ""
    from_name: str = "Sidesoft - Atención al Cliente"
    reply_to: str = ""
    timeout_seconds: int = Field(default=30, ge=5, le=120)

    @field_validator("host", "username", "from_email", "from_name", "reply_to", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> str:
        return str(v or "").strip()


class SmtpConfigIn(SmtpConfig):
    # None = conservar la contraseña guardada; "" = borrarla.
    password: Optional[str] = None


class SmtpNotConfigured(RuntimeError):
    pass


def load_smtp_raw() -> Dict[str, Any]:
    return get_setting(KEY_SMTP) or {}


def load_smtp_public() -> Dict[str, Any]:
    raw = load_smtp_raw()
    cfg = SmtpConfig(**{k: v for k, v in raw.items() if k in SmtpConfig.model_fields})
    return {**cfg.model_dump(), "password_set": bool(raw.get("password_enc"))}


def save_smtp(data: SmtpConfigIn, users_id: int) -> Dict[str, Any]:
    raw = load_smtp_raw()
    payload = SmtpConfig(**data.model_dump(exclude={"password"})).model_dump()
    if data.password is None:
        payload["password_enc"] = raw.get("password_enc", "")
    else:
        payload["password_enc"] = encrypt_secret(data.password) if data.password else ""
    set_setting(KEY_SMTP, payload, users_id)
    return load_smtp_public()


def _resolved() -> Tuple[SmtpConfig, str]:
    raw = load_smtp_raw()
    cfg = SmtpConfig(**{k: v for k, v in raw.items() if k in SmtpConfig.model_fields})
    if not cfg.host or not cfg.from_email:
        raise SmtpNotConfigured("SMTP no configurado: complete servidor y correo remitente en Configuraciones del sistema.")
    return cfg, decrypt_secret(raw.get("password_enc", ""))


def _connect(cfg: SmtpConfig, password: str) -> smtplib.SMTP:
    ctx = ssl.create_default_context()
    if cfg.security == "ssl":
        server: smtplib.SMTP = smtplib.SMTP_SSL(cfg.host, cfg.port, timeout=cfg.timeout_seconds, context=ctx)
    else:
        server = smtplib.SMTP(cfg.host, cfg.port, timeout=cfg.timeout_seconds)
        server.ehlo()
        if cfg.security == "starttls":
            server.starttls(context=ctx)
            server.ehlo()
    if cfg.username:
        server.login(cfg.username, password)
    return server


def test_connection() -> None:
    cfg, password = _resolved()
    server = _connect(cfg, password)
    try:
        server.noop()
    finally:
        server.quit()


def send_mail(
    to: Sequence[str],
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    cc: Sequence[str] = (),
    bcc: Sequence[str] = (),
    attachments: Sequence[Tuple[str, bytes]] = (),
    inline_images: Sequence[Tuple[str, bytes, str]] = (),
) -> str:
    """
    Envía un correo; devuelve el Message-ID. Lanza excepción si el servidor rechaza.
    `inline_images`: (content_id sin <>, bytes, subtipo p. ej. "jpeg") referenciadas en el HTML como «cid:content_id».
    """
    if not to:
        raise ValueError("Sin destinatarios.")
    cfg, password = _resolved()
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((cfg.from_name, cfg.from_email)) if cfg.from_name else cfg.from_email
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if cfg.reply_to:
        msg["Reply-To"] = cfg.reply_to
    domain = cfg.from_email.split("@")[-1] if "@" in cfg.from_email else None
    message_id = make_msgid(domain=domain)
    msg["Message-ID"] = message_id
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
        html_part = msg.get_payload()[-1]
        for cid, data, subtype in inline_images:
            html_part.add_related(data, maintype="image", subtype=subtype, cid=f"<{cid}>", disposition="inline")
    for filename, data in attachments:
        ctype, _ = mimetypes.guess_type(filename)
        maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)

    server = _connect(cfg, password)
    try:
        refused = server.send_message(msg, to_addrs=list(dict.fromkeys([*to, *cc, *bcc])))
    finally:
        try:
            server.quit()
        except smtplib.SMTPException:
            pass
    if refused:
        raise smtplib.SMTPRecipientsRefused(refused)
    return message_id


def glpi_smtp_defaults() -> Dict[str, Any]:
    """Valores SMTP de la configuración de notificaciones de GLPI (sin contraseña: GLPI la cifra con su propia clave)."""
    rows = fetch_all(
        """
        SELECT name, value FROM glpi_configs
        WHERE context = 'core'
          AND name IN ('smtp_host', 'smtp_port', 'smtp_mode', 'smtp_username', 'smtp_sender',
                       'from_email', 'from_email_name', 'replyto_email')
        """
    )
    v = {r["name"]: (r.get("value") or "").strip() for r in rows}
    # GLPI: smtp_mode 0 = mail(), 1 = SMTP, 2 = SMTP+SSL, 3 = SMTP+TLS (STARTTLS)
    mode = v.get("smtp_mode", "")
    security: Security = "ssl" if mode == "2" else "starttls" if mode == "3" else "none"
    try:
        port = int(v.get("smtp_port") or 0) or 587
    except ValueError:
        port = 587
    return {
        "host": v.get("smtp_host", ""),
        "port": port,
        "security": security,
        "username": v.get("smtp_username", ""),
        "from_email": v.get("from_email") or v.get("smtp_sender", ""),
        "from_name": v.get("from_email_name", ""),
        "reply_to": v.get("replyto_email", ""),
    }


def normalize_email_list(raw: Any) -> List[str]:
    """Acepta lista o texto separado por coma/;/salto de línea; devuelve correos únicos válidos (básico)."""
    if raw is None:
        return []
    items = raw if isinstance(raw, list) else str(raw).replace(";", ",").replace("\n", ",").split(",")
    out: List[str] = []
    seen = set()
    for it in items:
        e = str(it).strip()
        if not e or "@" not in e or " " in e:
            continue
        k = e.lower()
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out

