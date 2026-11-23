# EVIS OCPP Emulator — backend

NestJS application: the REST API, the OCPP 1.6 engine and the SQLite storage.
What the emulator does and how to use it is in the [main README](../README.md).

```bash
pnpm install
pnpm start:dev     # http://localhost:3000, restarts on changes
pnpm test          # end-to-end tests against a mock CSMS
pnpm lint
pnpm build && pnpm start:prod
pnpm mock:csms     # a stand-in CSMS on ws://localhost:9220
```

## Where things are

| Path | What it is |
| --- | --- |
| `src/engine/virtual-charge-point.ts` | One emulated charger: connection, boot, statuses, transactions, the offline queue |
| `src/engine/csms-requests.ts` | A handler for every request a CSMS can send |
| `src/engine/firmware.ts` | UpdateFirmware, GetDiagnostics, GetLog, SignedUpdateFirmware |
| `src/engine/engine.ts` | Owns all chargers and cars and drives the one-second clock |
| `src/engine/ocpp16/` | Configuration keys, request validation, smart-charging maths, meter values, X.509 helpers |
| `src/engine/rpc/` | OCPP-J over WebSocket: one call at a time, reconnect, Basic auth, TLS |
| `src/engine/sim/physics.ts` | How much power a car takes from a connector |
| `src/engine/history.service.ts` | Read side: sessions, per-connector totals, logbook |
| `src/api/` | REST controllers and their request validation |
| `src/entities/` | The SQLite tables |
| `test/support/mock-csms.ts` | The mock Central System the tests and `pnpm mock:csms` use |

## How the engine is built

Each charger is an actor: every state change runs through `run()`, one at a
time, so a clock tick, a CSMS request and a click in the UI never interleave.
Network round trips are never awaited inside `run()`; their answers come back as
new jobs. State is written to SQLite as each job ends.

Time comes from an injectable clock, and timers are deadlines checked on each
tick. Tests replace the clock and advance it by hand, which is why they can run
an hour of charging in milliseconds.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `SQLITE_PATH` | `data/emulator.sqlite` | `:memory:` for a throw-away database |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | `dev-secret-change-me`, `7d` | Used once the instance is locked |
| `ENGINE_AUTOTICK` | `true` | `false` stops the clock (tests drive it themselves) |

The schema is created and updated from the entities on start (`synchronize`).
