"""
Worker del envío automático de informes (servicio `worker` en docker-compose).

Cada TICK segundos:
  1. Registra un latido (visible en «Configuraciones del sistema»).
  2. Toma un candado MySQL (GET_LOCK) para que solo un worker procese a la vez.
  3. Encola la ocurrencia programada vencida (si no existe ya), ejecuta las ejecuciones en cola
     (automáticas y manuales) y los reintentos cuyo plazo venció.

Uso: python -m app.jobs.worker
"""

import logging
import signal
import socket
import threading
from datetime import datetime, timezone

from app.db import get_connection
from app.modules.sistema import report_mail
from app.modules.sistema.schema import ensure_schema
from app.modules.sistema.store import KEY_WORKER_HEARTBEAT, set_setting

TICK_SECONDS = 30
LOCK_NAME = "coorddash_report_worker"

log = logging.getLogger("worker")
_stop = threading.Event()


def _tick() -> None:
    set_setting(KEY_WORKER_HEARTBEAT, {"at": datetime.now(timezone.utc).isoformat(), "host": socket.gethostname()})
    # El candado vive en esta conexión: se libera al cerrarla aunque el proceso muera.
    with get_connection(read_timeout=30) as lock_conn:
        with lock_conn.cursor() as cur:
            cur.execute("SELECT GET_LOCK(%s, 0) AS got", (LOCK_NAME,))
            if not (cur.fetchone() or {}).get("got"):
                log.debug("Otro worker tiene el candado; se omite este ciclo.")
                return
        try:
            cfg = report_mail.load_schedule()
            report_mail.recover_stale_sending()
            run_id = report_mail.enqueue_due_auto_run(cfg)
            if run_id:
                log.info("Ejecución automática #%s encolada.", run_id)
            n_runs = report_mail.process_queued_runs(cfg)
            n_retries = report_mail.process_due_retries(cfg)
            if n_runs or n_retries:
                log.info("Procesadas %s ejecución(es) y %s reintento(s).", n_runs, n_retries)
        finally:
            with lock_conn.cursor() as cur:
                cur.execute("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    signal.signal(signal.SIGTERM, lambda *_: _stop.set())
    signal.signal(signal.SIGINT, lambda *_: _stop.set())
    log.info("Worker de informes iniciado (ciclo %ss).", TICK_SECONDS)
    schema_ok = False
    while not _stop.is_set():
        try:
            if not schema_ok:
                ensure_schema()
                schema_ok = True
            _tick()
        except Exception:  # noqa: BLE001 — el worker no debe morir por un error transitorio (BD/SMTP)
            log.exception("Error en el ciclo del worker")
        _stop.wait(TICK_SECONDS)
    log.info("Worker detenido.")


if __name__ == "__main__":
    main()
