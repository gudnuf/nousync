import { findFreePort, connectHolesail } from '../core/network.js';

export class DirectoryClient {
  constructor(url, { timeout = 10_000 } = {}) {
    this.url = url;
    this.timeout = timeout;
    this.holesail = null;
    this.localPort = null;
    this.connected = false;
  }

  async connect() {
    this.localPort = await findFreePort();
    this.holesail = await connectHolesail(this.url, this.localPort);
    this.connected = true;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.localPort}`;
  }

  async register(profile) {
    if (!this.connected) throw new Error('Not connected. Call connect() first.');

    const res = await fetch(`${this.baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Register failed (${res.status}): ${err.error}`);
    }

    return res.json();
  }

  async heartbeat(agent_id) {
    if (!this.connected) throw new Error('Not connected. Call connect() first.');

    const res = await fetch(`${this.baseUrl}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Heartbeat failed (${res.status}): ${err.error}`);
    }

    return res.json();
  }

  async discover(query) {
    if (!this.connected) throw new Error('Not connected. Call connect() first.');

    const res = await fetch(`${this.baseUrl}/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Discover failed (${res.status}): ${err.error}`);
    }

    return res.json();
  }

  async disconnect() {
    if (this.holesail) {
      await this.holesail.close();
    }
    this.connected = false;
    this.localPort = null;
  }
}
