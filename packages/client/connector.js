import { findFreePort, connectHolesail } from '../core/network.js';

export class AgentClient {
  constructor(url, { timeout = 10_000 } = {}) {
    this.url = url;
    this.timeout = timeout;
    this.holesail = null;
    this.localPort = null;
    this.connected = false;
    this.sessionId = null;
  }

  async connect() {
    this.localPort = await findFreePort();
    this.holesail = await connectHolesail(this.url, this.localPort);
    this.connected = true;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.localPort}`;
  }

  async ask(question, { sessionId, context, cashuToken } = {}) {
    if (!this.connected) throw new Error('Not connected. Call connect() first.');

    const sid = sessionId || this.sessionId;
    const body = { question };
    if (sid) body.session_id = sid;
    if (context) body.context = context;

    const headers = { 'Content-Type': 'application/json' };
    if (cashuToken) headers['X-Cashu'] = cashuToken;

    const res = await fetch(`${this.baseUrl}/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (res.status === 402) {
      const data = await res.json();
      return {
        payment_required: true,
        payment_request: res.headers.get('x-cashu'),
        amount: data.amount,
        unit: data.unit,
      };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Ask failed (${res.status}): ${err.error}`);
    }

    const result = await res.json();
    // Auto-track session ID for follow-ups
    this.sessionId = result.session_id;
    return result;
  }

  async getProfile() {
    if (!this.connected) throw new Error('Not connected. Call connect() first.');

    const res = await fetch(`${this.baseUrl}/profile`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) throw new Error(`Profile failed (${res.status})`);
    return res.json();
  }

  async getStatus() {
    if (!this.connected) throw new Error('Not connected. Call connect() first.');

    const res = await fetch(`${this.baseUrl}/status`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) throw new Error(`Status failed (${res.status})`);
    return res.json();
  }

  async disconnect() {
    if (this.holesail) {
      await this.holesail.close();
    }
    this.connected = false;
    this.sessionId = null;
    this.localPort = null;
  }
}
