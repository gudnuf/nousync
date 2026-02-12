const dim = s => `\x1b[2m${s}\x1b[0m`;

export function log(icon, msg, detail) {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const parts = [dim(time), icon, msg];
  if (detail) parts.push(dim(detail));
  console.log(parts.join(' '));
}
