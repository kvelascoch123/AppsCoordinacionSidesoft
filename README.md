# Sistema Coordinación Soporte

Panel web **configurable** que se conecta en **solo lectura** a la base MySQL/MariaDB de **GLPI 10.x** para **coordinación de soporte**: indicadores operativos (asignaciones, tickets sin gestión, antigüedad, tiempo en tareas), **gestión por técnico** con rango de fechas, **informes de soporte** exportables a Word, **análisis agregado con IA** (OpenAI) y análisis por ticket individual.

> **Nombre sugerido en GitHub:** el slug del repositorio no puede llevar espacios; use por ejemplo `sistema-coordinacion-soporte` y como descripción del repo: *Sistema Coordinación Soporte*.

## Stack

| Capa | Tecnología |
|------|------------|
| Backend | Python 3.10+, FastAPI, PyMySQL |
| Frontend | React 18, TypeScript, Vite 4, Recharts |
| Contenedores | Docker Compose (API + Nginx con SPA) |
| IA (opcional) | OpenAI API (`OPENAI_API_KEY`) |

## Requisitos

- **Docker (recomendado):** Docker Desktop o Docker Engine + Compose v2.
- **Sin Docker:** Python 3.10+, Node.js **≥ 14.18** (se recomienda **18+**).
- Red hasta el servidor MySQL/MariaDB de GLPI.
- **Seguridad:** usuario MySQL con permisos `SELECT` (y cualquier otro mínimo necesario) sobre las tablas GLPI que consulta el panel.

## Puesta en marcha con Docker

En la **raíz del repositorio** (donde está `docker-compose.yml`):

1. Copie la plantilla de entorno:

   ```powershell
   copy .env.example .env
   ```

   En Linux/macOS: `cp .env.example .env`

2. Edite **`.env`**: conexión a la base (`GLPI_DB_*`), CORS si aplica, y opcionalmente `OPENAI_API_KEY` para funciones de IA.
   - Si MySQL está en **su PC** y usa Docker Desktop: suele funcionar `GLPI_DB_HOST=host.docker.internal`.
   - En **Linux**, `docker-compose` incluye `extra_hosts: host.docker.internal:host-gateway` para el servicio `api`.

3. Construir e iniciar:

   ```powershell
   docker compose build
   docker compose up -d
   ```

4. Abrir el panel: **http://localhost:8080** (cambie el puerto con `WEB_PORT` en `.env`).

Comandos útiles:

```powershell
docker compose logs -f api
docker compose down
```

El contenedor **web** (Nginx) sirve el frontend y hace **proxy** de `/api` al servicio **api** (FastAPI).

## Puesta en marcha sin Docker

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Configure variables (puede usar un `.env` en la raíz del proyecto si lanza desde ahí según su `config`, o copiar valores según `app/config.py`). Arranque:

```powershell
cd backend
.\.venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Comprobaciones: `http://127.0.0.1:8000/api/health`, `http://127.0.0.1:8000/api/health/db`, `http://127.0.0.1:8000/api/dashboard`.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Abra `http://127.0.0.1:5173`. Vite reenvía `/api` al backend en el puerto 8000 (`vite.config.ts`).

Build de producción:

```powershell
npm run build
```

## Variables de entorno principales

| Variable | Descripción |
|----------|-------------|
| `GLPI_DB_HOST`, `GLPI_DB_PORT`, `GLPI_DB_USER`, `GLPI_DB_PASSWORD`, `GLPI_DB_NAME` | Conexión MySQL/MariaDB a GLPI |
| `GLPI_ENTITIES_ID` | (Opcional) Filtra por entidad |
| `DASHBOARD_STALE_HOURS` | Umbral en horas para tickets “estancados” sin seguimiento público |
| `CORS_ORIGINS` | Orígenes permitidos (lista separada por comas) |
| `WEB_PORT` | Puerto publicado del panel en Docker (por defecto `8080`) |
| `OPENAI_API_KEY` | Clave OpenAI para análisis por ticket y análisis de proyecto |

Definiciones operativas habituales: tickets abiertos, sin asignar (`glpi_tickets_users`), sin seguimiento ITIL público, tiempo en `glpi_tickettasks`, proyectos vía tablas GLPI/plugins según implementación en `app/metrics.py` y `app/reports.py`.

## Acceso y envío automático de informes

- **Acceso:** el panel exige iniciar sesión con usuario y contraseña de **GLPI** (cuentas locales, hash bcrypt).
  Pueden ingresar los perfiles de `DASHBOARD_ALLOWED_PROFILES`; el menú **Configuraciones del sistema** solo lo
  ven los de `DASHBOARD_ADMIN_PROFILES`. La sesión es una cookie HttpOnly firmada (`DASHBOARD_SESSION_SECRET`).
- **Configuraciones del sistema → Correo e informes automáticos:** SMTP (contraseña cifrada con
  `DASHBOARD_ENCRYPTION_KEY`), programación (frecuencia, hora, período), proyectos incluidos con tarifa/contrato/IVA,
  vista previa del correo y del informe, envío manual e historial con reintentos.
- **Un correo por proyecto:** *Para* = solicitantes de los tickets del informe (+ extra del proyecto); *CC* global y
  por proyecto. El informe (PDF y/o Word) se genera en Python con el mismo diseño del export del navegador.
- **Servicio `worker`** (`python -m app.jobs.worker`): revisa cada 30 s si toca enviar, procesa envíos en cola y
  reintentos. Usa `GET_LOCK` de MySQL para no duplicar envíos.
- **Tablas propias en la BD de GLPI** (se crean solas al arrancar): `glpi_plugin_coorddash_settings`,
  `glpi_plugin_coorddash_report_projects`, `glpi_plugin_coorddash_report_runs` y `glpi_plugin_coorddash_report_sends`.
- Empieza en **modo prueba** (todo se envía a los destinatarios de prueba) hasta que se desactive.

## Subir este proyecto a GitHub

GitHub **no permite espacios** en el nombre del repositorio. Cree el repositorio con un nombre como `sistema-coordinacion-soporte` y descripción *Sistema Coordinación Soporte*.

1. En [github.com/new](https://github.com/new) cree un repositorio **vacío** (sin README ni `.gitignore` iniciales si ya los tiene en local).

2. En la carpeta del proyecto:

   ```powershell
   cd "c:\Users\kvela\OneDrive\Documentos\GLPI DB TABLES\glpi-coordination-dashboard"
   git init
   git add .
   git commit -m "Initial commit: Sistema Coordinación Soporte"
   git branch -M main
   git remote add origin https://github.com/SU_USUARIO/sistema-coordinacion-soporte.git
   git push -u origin main
   ```

   Sustituya `SU_USUARIO` por su usuario u organización de GitHub.

**Importante:** no suba el archivo `.env` (ya está en `.gitignore`). Use solo `.env.example` como referencia.

## Licencia

Uso interno / ejemplo de integración; adapte la licencia a las políticas de su organización.
