import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Holesail from 'holesail';

export function getOrCreateSeed(seedFile) {
  try {
    return readFileSync(seedFile, 'utf8').trim();
  } catch {
    const seed = randomBytes(32).toString('hex');
    mkdirSync(dirname(seedFile), { recursive: true });
    writeFileSync(seedFile, seed + '\n', { mode: 0o600 });
    return seed;
  }
}

export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createTcpServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export async function connectHolesail(url, localPort) {
  const holesail = new Holesail({
    client: true,
    key: url,
    port: localPort,
    host: '127.0.0.1',
  });
  await holesail.ready();
  // Stabilization delay from PoC findings
  await new Promise(r => setTimeout(r, 500));
  return holesail;
}

export async function startNetwork(app, { port = 0, host = '127.0.0.1', seed } = {}) {
  // Start HTTP server on ephemeral port
  const httpServer = createHttpServer(app);
  await new Promise((resolve) => {
    httpServer.listen(port, host, resolve);
  });

  const actualPort = httpServer.address().port;

  // Start Holesail server tunneling to that port
  const holesailOpts = {
    server: true,
    port: actualPort,
    host,
    secure: true,
  };
  if (seed) holesailOpts.key = seed;

  const holesail = new Holesail(holesailOpts);

  await holesail.ready();
  const info = holesail.info;

  return {
    url: info.url,
    port: actualPort,
    publicKey: info.publicKey,
    seed,
    async stop() {
      // Close Holesail first, then HTTP server
      await holesail.close();
      await new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
