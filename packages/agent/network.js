import { createServer } from 'node:http';
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

export async function startNetwork(app, { port = 0, host = '127.0.0.1', seed } = {}) {
  // Start HTTP server on ephemeral port
  const httpServer = createServer(app);
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
