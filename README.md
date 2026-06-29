# EVIS OCPP Emulator

An open-source OCPP (Open Charge Point Protocol) emulator. Define virtual
**charge points** that connect out to *your* CSMS backend over WebSocket and
speak **OCPP 1.6**, define **electric cars**, plug them in, and watch a
realistic charging simulation burn kWh in real time — all from a dashboard UI.

## What it does

- **Charge points** — create stations with any number of connectors (Type2, CCS,
  CHAdeMO, …) and per-connector max power. Each connects as an OCPP 1.6 *client*
  to a CSMS WebSocket URL you provide (BootNotification, Heartbeat,
  StatusNotification, Authorize, StartTransaction, MeterValues, StopTransaction;
  handles RemoteStart/Stop, Change/GetConfiguration, Reset, SetChargingProfile…).
- **Cars** — battery capacity, current charge, supported connectors, and max
  intake power (back-pressure). Drain/refill the battery to test scenarios.
- **Charging simulation** — link a car to a connector and start charging. Power
  is `min(connector max, car intake, CSMS charging-profile limit)`; energy and
  battery SoC tick up in real time and persist; at 100% it auto-stops via OCPP.
- **Live dashboard** — Mantine UI with realtime updates over Socket.IO.
- **Optional lock** — runs fully open by default; click 🔒 to register a user and
  require JWT auth (handy when hosting it).

## Project structure

```
.
├── back_end/          # NestJS API + OCPP 1.6 engine (TypeORM + MongoDB)
│   ├── api/           # REST: auth, charge-points, cars, sessions
│   ├── ocpp-ws/       # OCPP-J client, connection manager, charging simulation
│   ├── realtime/      # Socket.IO gateway (live updates to the UI)
│   ├── entities/      # Mongo entities (base, user, charge-point, car, session)
│   └── libs/          # shared (auth guard/decorators)
├── UI/                # React + Vite + Mantine dashboard
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
   curl http://localhost:3000/api/auth/status
   # -> {"locked":false}
   ```

To stop: `Ctrl+C`, or `docker compose down`. Mongo data is kept in a named
volume (`mongo_data`); wipe it with `docker compose down -v`.

## Running the UI

The dashboard runs separately from Vite (the backend has CORS enabled):

```bash
cd UI
yarn install
yarn dev          # http://localhost:5173
```

By default the UI talks to the backend at `http://localhost:3000/api`. To point
it elsewhere, set `VITE_API_URL` and `VITE_WS_URL`:

```bash
VITE_API_URL=http://localhost:3000/api VITE_WS_URL=http://localhost:3000 yarn dev
```

### Try it end-to-end

1. **Cars** → *New car* (e.g. 50 kWh, Type2, 50 kW intake, start it low).
2. **Charge Points** → *New charge point*, set the **CSMS WebSocket URL** to your
   backend under test, add a connector, save, then **Connect**.
3. On the connected connector, pick the car and **Start** — watch power, energy
   and battery % climb live until it auto-stops at 100%.

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
