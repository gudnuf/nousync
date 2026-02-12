import { encode } from 'cbor-x';
import { getDecodedToken } from 'coco-cashu-core';

export function tokenAmount(token) {
  const decoded = getDecodedToken(token);
  // V4 tokens have proofs at top level, V3 tokens nest them in token[]
  if (decoded.proofs) {
    return decoded.proofs.reduce((s, p) => s + p.amount, 0);
  }
  return decoded.token.reduce(
    (sum, entry) => sum + entry.proofs.reduce((s, p) => s + p.amount, 0),
    0,
  );
}

// NUT-18: Build a payment request and encode as "creqA" + base64url(CBOR)
export function encodePaymentRequest(amount, unit, mints) {
  const payload = {
    a: amount,
    u: unit,
    m: mints.map(url => ({ u: url })),
  };
  const cbor = encode(payload);
  const b64 = Buffer.from(cbor).toString('base64url');
  return 'creqA' + b64;
}

export function createPaymentMiddleware(wallet, config, { gatePaths = ['/ask'] } = {}) {
  return async (req, res, next) => {
    if (!config.payment?.enabled) return next();
    if (!gatePaths.some(p => req.method === 'POST' && req.path === p)) return next();

    const token = req.headers['x-cashu'];

    if (!token) {
      const { amount, unit, mints } = config.payment;
      const paymentRequest = encodePaymentRequest(amount, unit, mints);
      res.status(402)
        .set('X-Cashu', paymentRequest)
        .json({
          error: 'Payment required',
          amount,
          unit,
        });
      return;
    }

    // Verify amount before claiming
    let amount;
    try {
      amount = tokenAmount(token);
    } catch {
      res.status(400).json({ error: 'Invalid cashu token' });
      return;
    }

    if (amount < config.payment.amount) {
      res.status(402).json({
        error: 'Insufficient payment',
        required: config.payment.amount,
        received: amount,
        unit: config.payment.unit,
      });
      return;
    }

    // Claim token BEFORE processing request (fund safety)
    try {
      await wallet.receive(token);
    } catch (err) {
      res.status(400).json({ error: `Payment failed: ${err.message}` });
      return;
    }

    next();
  };
}
