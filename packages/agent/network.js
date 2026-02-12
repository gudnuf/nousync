import { createServer } from 'node:http';
import Holesail from 'holesail';

export async function startNetwork(app, { port = 0, host = '127.0.0.1' } = {}) {
  // Start HTTP server on ephemeral port
  const httpServer = createServer(app);
  await new Promise((resolve) => {
    httpServer.listen(port, host, resolve);
  });

  const actualPort = httpServer.address().port;

  // Start Holesail server tunneling to that port
  const holesail = new Holesail({
    server: true,
    port: actualPort,
    host,
    secure: true,
  });

  await holesail.ready();
  const info = holesail.info;

  return {
    url: info.url,
    port: actualPort,
    publicKey: info.publicKey,
    async stop() {
      // Close Holesail first, then HTTP server
      await holesail.close();
      await new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
