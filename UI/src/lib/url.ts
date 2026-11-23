/** The address a charger will dial. Mirrors resolveCsmsUrl() in the backend. */
export function resolveUrl(csmsUrl: string, appendId: boolean, chargePointId: string): string | null {
  let raw = csmsUrl.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) raw = raw.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(raw)) raw = `ws://${raw}`;
  try {
    const url = new URL(raw);
    if (appendId) {
      if (!chargePointId.trim()) return null;
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(chargePointId.trim())}`;
    }
    return url.toString();
  } catch {
    return null;
  }
}
