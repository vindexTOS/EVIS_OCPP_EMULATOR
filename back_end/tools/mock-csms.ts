import { createServer } from 'http';
import { MockCsms } from '../test/support/mock-csms';

// A stand-in Central System for trying the emulator without a real backend.
//
//   pnpm mock:csms                       OCPP on ws://localhost:9220/<chargePointId>
//   pnpm mock:csms --password secret     require HTTP Basic auth
//   pnpm mock:csms --port 9300 --http 9301
//
// Control it over HTTP (default port 9221):
//   GET  /chargers                       connected charge point ids
//   GET  /messages?action=MeterValues    what the chargers sent
//   POST /call/<chargePointId>/<Action>  send a request; the JSON body is the payload
//     curl -X POST localhost:9221/call/CP001/RemoteStartTransaction \
//          -H 'content-type: application/json' -d '{"connectorId":1,"idTag":"APP"}'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

async function main() {
  const port = Number(arg('port', '9220'));
  const httpPort = Number(arg('http', String(port + 1)));
  const password = arg('password');
  const csms = new MockCsms({ port, password });
  await csms.start();

  let printed = 0;
  setInterval(() => {
    for (; printed < csms.received.length; printed++) {
      const m = csms.received[printed];
      console.log(
        `${new Date(m.at).toISOString()}  ${m.cpId}  ${m.action}  ${JSON.stringify(m.payload)}`,
      );
    }
  }, 200);

  createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && parts[0] === 'chargers') {
      const ids = [...new Set(csms.received.map((m) => m.cpId))].filter((id) =>
        csms.connected(id),
      );
      return send(200, ids);
    }
    if (req.method === 'GET' && parts[0] === 'messages') {
      const action = url.searchParams.get('action') ?? undefined;
      return send(
        200,
        csms.received.filter((m) => !action || m.action === action),
      );
    }
    if (req.method === 'POST' && parts[0] === 'call' && parts.length === 3) {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let payload: unknown = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          return send(400, { error: 'The body is not valid JSON' });
        }
        csms
          .call(decodeURIComponent(parts[1]), parts[2], payload)
          .then((result) => send(200, result))
          .catch((err: Error) => send(502, { error: err.message }));
      });
      return;
    }
    send(404, { error: 'Not found' });
  }).listen(httpPort);

  console.log(
    `Mock CSMS listening on ws://localhost:${port}/<chargePointId>${password ? ' (Basic auth on)' : ''}`,
  );
  console.log(`Control API on http://localhost:${httpPort}`);
}

void main();
