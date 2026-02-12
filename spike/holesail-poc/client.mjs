// Holesail client PoC: Connects to a Holesail tunnel and makes HTTP requests through it
import Holesail from 'holesail'
import { readFileSync } from 'fs'

const CLIENT_PORT = 4567

// Read connection info from server
let connectionInfo
try {
  connectionInfo = JSON.parse(readFileSync('connection.json', 'utf8'))
} catch {
  console.error('No connection.json found. Start server.mjs first.')
  process.exit(1)
}

console.log(`Connecting to: ${connectionInfo.url}`)
console.log(`Secure: ${connectionInfo.secure}`)

const startTime = Date.now()
const hs = new Holesail({
  client: true,
  key: connectionInfo.url,
  port: CLIENT_PORT,
  host: '127.0.0.1'
})

await hs.ready()
const elapsed = Date.now() - startTime
const info = hs.info

console.log('\n--- Holesail Client Info ---')
console.log(`Type:       ${info.type}`)
console.log(`State:      ${info.state}`)
console.log(`Secure:     ${info.secure}`)
console.log(`Protocol:   ${info.protocol}`)
console.log(`Local:      ${info.host}:${info.port}`)
console.log(`Connected in: ${elapsed}ms`)
console.log('---------------------------\n')

// Give the proxy a moment to fully establish
await new Promise(r => setTimeout(r, 2000))

// Now make HTTP requests through the tunnel
console.log('Making HTTP requests through tunnel...\n')

async function makeRequest(path) {
  const url = `http://127.0.0.1:${CLIENT_PORT}${path}`
  const reqStart = Date.now()
  try {
    const res = await fetch(url)
    const body = await res.json()
    const latency = Date.now() - reqStart
    console.log(`GET ${path} => ${res.status} (${latency}ms)`)
    console.log(`  Response: ${JSON.stringify(body)}`)
    return { status: res.status, latency, body }
  } catch (err) {
    const latency = Date.now() - reqStart
    console.log(`GET ${path} => ERROR (${latency}ms): ${err.message}`)
    return { error: err.message, latency }
  }
}

// Test 1: Basic endpoint
const r1 = await makeRequest('/')

// Test 2: Echo endpoint
const r2 = await makeRequest('/echo/holesail-works')

// Test 3: Latency test — 5 sequential requests
console.log('\nLatency test (5 sequential requests to /)...')
const latencies = []
for (let i = 0; i < 5; i++) {
  const r = await makeRequest('/')
  latencies.push(r.latency)
}
const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length
const min = Math.min(...latencies)
const max = Math.max(...latencies)
console.log(`\nLatency: avg=${avg.toFixed(0)}ms, min=${min}ms, max=${max}ms`)

// Summary
console.log('\n=== PoC Summary ===')
console.log(`Connection time: ${elapsed}ms`)
console.log(`Tunnel works: ${r1.status === 200 && r2.status === 200 ? 'YES' : 'NO'}`)
console.log(`Average latency: ${avg.toFixed(0)}ms`)
console.log('===================\n')

// Cleanup
console.log('Closing client...')
await hs.close()
process.exit(0)
