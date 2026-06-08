# EVIS OCPP Emulator

An open-source OCPP (Open Charge Point Protocol) emulator with a UI and backend.

> **Status:** early development. Right now the stack is just the NestJS backend
> connected to MongoDB. More features (OCPP charge-point simulation, the UI, etc.)
> are coming.

## Project structure

```
.
├── back_end/          # NestJS API (TypeORM + MongoDB)
├── UI/                # Frontend (Vite/React)
└── docker-compose.yml # Spins up MongoDB + the backend
```

## Quick start (Docker)

Everything you need to run the backend and database is in Docker — no local
Node or MongoDB install required.

1. **Install [Docker](https://docs.docker.com/get-docker/)** (Docker Desktop on
   Mac/Windows, or Docker Engine + Compose on Linux).

2. **Create your env file** (optional — sensible defaults are built in):

   ```bash
   cp .env.example .env
   ```

3. **Start the stack:**

   ```bash
   docker compose up
   ```

   This builds and runs:
   - **MongoDB** on `localhost:27017`
   - **NestJS backend** on `localhost:3000` (with hot reload)

   The backend connects to MongoDB automatically over TypeORM.

4. **Verify it's up:**

   ```bash
   curl http://localhost:3000
   # -> Hello World!
   ```

To stop: `Ctrl+C`, or `docker compose down`. Mongo data is kept in a named
volume (`mongo_data`); wipe it with `docker compose down -v`.

## Configuration

All settings have defaults and can be overridden in `.env`:

| Variable             | Default          | Description                       |
| -------------------- | ---------------- | --------------------------------- |
| `MONGO_ROOT_USER`    | `root`           | MongoDB root username             |
| `MONGO_ROOT_PASSWORD`| `example`        | MongoDB root password             |
| `MONGO_DB`           | `ocpp_emulator`  | Database name                     |
| `MONGO_PORT`         | `27017`          | Host port for MongoDB             |
| `BACKEND_PORT`       | `3000`           | Host port for the NestJS backend  |

The backend reads its connection from `MONGO_URI` (assembled automatically by
Compose). To run the backend outside Docker against the Dockerized Mongo, set:

```bash
MONGO_URI=mongodb://root:example@localhost:27017/ocpp_emulator?authSource=admin
```

## Running the backend without Docker

If you prefer to run Node locally (you still need MongoDB running somewhere):

```bash
cd back_end
pnpm install
pnpm run start:dev
```

## License

Open source — license TBD.
