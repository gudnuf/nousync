// Holesail server PoC: Exposes a local Express HTTP server via Holesail tunnel
import Holesail from 'holesail'
import express from 'express'
import { createServer } from 'http'

const LOCAL_PORT = 3456
const app = express()

app.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), message: 'Hello from Holesail tunnel!' })
})

app.get('/echo/:text', (req, res) => {
  res.json({ echo: req.params.text })
})

// Start Express on local port first
const httpServer = createServer(app)
httpServer.listen(LOCAL_PORT, '127.0.0.1', async () => {
  console.log(`Express listening on 127.0.0.1:${LOCAL_PORT}`)

  // Now expose that port via Holesail
  const startTime = Date.now()
  const hs = new Holesail({
    server: true,
    port: LOCAL_PORT,
    host: '127.0.0.1',
    secure: true
  })

  await hs.ready()
  const elapsed = Date.now() - startTime
  const info = hs.info

  console.log('\n--- Holesail Server Info ---')
  console.log(`URL:        ${info.url}`)
  console.log(`Key:        ${info.key}`)
  console.log(`Public Key: ${info.publicKey}`)
  console.log(`Type:       ${info.type}`)
  console.log(`State:      ${info.state}`)
  console.log(`Secure:     ${info.secure}`)
  console.log(`Protocol:   ${info.protocol}`)
  console.log(`Port:       ${info.port}`)
  console.log(`Host:       ${info.host}`)
  console.log(`Ready in:   ${elapsed}ms`)
  console.log('---------------------------\n')
  console.log('Server running. Press Ctrl+C to stop.')

  // Write connection info to file for client to read
  const fs = await import('fs')
  fs.writeFileSync('connection.json', JSON.stringify({
    url: info.url,
    key: info.key,
    secure: info.secure,
    startedAt: new Date().toISOString(),
    readyMs: elapsed
  }, null, 2))
  console.log('Connection info written to connection.json')

  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await hs.close()
    httpServer.close()
    process.exit(0)
  })
})
