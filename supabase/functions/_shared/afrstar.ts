// Afrstar Nigeria Payment API v2 client (server only). Secrets come from the
// edge function env (AFRSTAR_MERCHANT_SN / _AK / _SK) and never reach the browser.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient } from 'npm:@supabase/supabase-js@2';

export const BASE = 'https://ngn.afrstar.com';
export const PREFIX = { USER_DEPOSIT: 'TOPD', ADMIN_TOPUP: 'TOPAT', USER_WITHDRAWAL: 'TOPW', ADMIN_PAYOUT: 'TOPAP' } as const;
// Two modes: direct (own merchant keys) or relay (shares the Altivex Afrstar merchant
// through https://altivex-invest.vercel.app/api/relay/afrstar, signed with AFRSTAR_RELAY_SECRET).
export type Config = { ok: true; relay: boolean; sn: string; ak: string; sk: string } | { ok: false; missing: string[]; error: string };
const RELAY_URL = (Deno.env.get('AFRSTAR_RELAY_URL') || '').trim();
const RELAY_SECRET = (Deno.env.get('AFRSTAR_RELAY_SECRET') || '').trim();
const RELAY_CLIENT = (Deno.env.get('AFRSTAR_RELAY_CLIENT') || 'top').trim();
export const relayHmac = (ts: string, raw: string) => createHmac('sha256', RELAY_SECRET).update(`${ts}.${raw}`).digest('hex');
export function relayHmacOk(ts: string, raw: string, sig: string) {
  if (!RELAY_SECRET || !/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  return safeEqual(relayHmac(ts, raw), sig);
}
export async function relay(op: string, payload: Record<string, unknown> = {}): Promise<any> {
  const raw = JSON.stringify({ op, ...payload });
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const r = await fetch(RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relay-Client': RELAY_CLIENT, 'X-Relay-Ts': ts, 'X-Relay-Signature': relayHmac(ts, raw) }, body: raw, signal: AbortSignal.timeout(25000) });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, definitive: false, message: `Relay returned HTTP ${r.status}` };
    if (r.status === 401 || r.status === 403) return { ok: false, definitive: true, message: `Relay refused: ${j.error || r.status}` };
    return j;
  } catch (e) { return { ok: false, definitive: false, message: `Could not reach the relay: ${(e as Error).message}` }; }
}

export const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function getConfig(): Config {
  if (RELAY_URL && RELAY_SECRET) return { ok: true, relay: true, sn: '', ak: '', sk: '' };
  const keys = ['AFRSTAR_MERCHANT_SN', 'AFRSTAR_MERCHANT_AK', 'AFRSTAR_MERCHANT_SK'];
  const missing = keys.filter(k => !(Deno.env.get(k) || '').trim());
  if (missing.length) return { ok: false, missing, error: 'Payment gateway is not configured yet (merchant keys missing).' };
  return { ok: true, relay: false, sn: Deno.env.get('AFRSTAR_MERCHANT_SN')!.trim(), ak: Deno.env.get('AFRSTAR_MERCHANT_AK')!.trim(), sk: Deno.env.get('AFRSTAR_MERCHANT_SK')!.trim() };
}

export function money(v: unknown): string {
  const n = typeof v === 'string' ? Number(v.trim()) : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${v}`);
  return (Math.round((Math.abs(n) + Number.EPSILON) * 100) * Math.sign(n) / 100).toFixed(2);
}
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
const signValues = (...v: unknown[]) => md5(v.map(x => (x === null || x === undefined ? '' : String(x))).join(''));
type C = { relay?: boolean; sn: string; ak: string; sk: string };
export const sign = {
  payin: (c: C, osn: string, amt: unknown) => signValues(c.ak, osn, money(amt), c.sk),
  payout: (c: C, osn: string, acct: string, upi: string, amt: unknown) => signValues(c.ak, osn, acct, upi, money(amt), c.sk),
  balance: (c: C) => signValues(c.ak, c.sk),
  payinCallback: (c: C, posn: string, st: string, orig: unknown) => signValues(c.ak, posn, st, money(orig), c.sk),
  payoutCallback: (c: C, posn: string, st: string, amt: unknown) => signValues(c.ak, posn, st, money(amt), c.sk),
};
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(String(a || '').toLowerCase()), y = Buffer.from(String(b || '').toLowerCase());
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
export function makeOrderSn(prefix: string) {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}
export function orderKind(osn: string) {
  for (const [k, p] of Object.entries(PREFIX)) if (String(osn || '').startsWith(p + '-')) return k;
  return null;
}

export type GwResult = { ok: true; data: any } | { ok: false; definitive: boolean; message: string };
export async function post(path: string, body: Record<string, unknown>, timeoutMs = 20000): Promise<GwResult> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response, text: string;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    text = await res.text();
  } catch (e) {
    clearTimeout(t);
    return { ok: false, definitive: false, message: (e as Error)?.name === 'AbortError' ? 'No response from the gateway.' : `Could not reach the gateway: ${(e as Error).message}` };
  }
  clearTimeout(t);
  let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
  if (!j || typeof j !== 'object') {
    return { ok: false, definitive: res.status >= 400 && res.status < 500, message: `Gateway returned HTTP ${res.status}: ${String(text || '').replace(/\s+/g, ' ').slice(0, 200)}` };
  }
  if (Number(j.code) === 0) return { ok: true, data: j.data || {} };
  return { ok: false, definitive: true, message: `Gateway error ${j.code ?? ''}: ${j.message || j.msg || 'request refused'}` };
}
export function createPayin(c: C, o: { orderSn: string; amount: number; name: string; email: string; phone: string; remark: string; redirectUrl: string }): Promise<GwResult> {
  if (c.relay) return relay('payin', { ...o, amount: money(o.amount) });
  const body: Record<string, string> = {
    merchant_sn: c.sn, order_sn: o.orderSn, amount: money(o.amount), name: String(o.name || '').slice(0, 100),
    email: o.email || '', phone: o.phone || '', remark: (o.remark || 'Payment').slice(0, 100), redirect_url: o.redirectUrl,
  };
  body.sign = sign.payin(c, o.orderSn, body.amount);
  return post('/gateway/payin/', body);
}
export function createPayout(c: C, o: { orderSn: string; amount: number; name: string; account: string; bankCode: string; remark: string }): Promise<GwResult> {
  if (c.relay) return relay('payout', { ...o, amount: money(o.amount) });
  const body: Record<string, string> = {
    merchant_sn: c.sn, order_sn: o.orderSn, amount: money(o.amount), type: 'bank', name: String(o.name || '').slice(0, 100),
    account: o.account, ifsc: o.bankCode, upi_handle: '', remark: (o.remark || 'Payout').slice(0, 100),
  };
  body.sign = sign.payout(c, o.orderSn, body.account, '', body.amount);
  return post('/gateway/payout/', body);
}
export const getBalance = (c: C): Promise<GwResult> => c.relay ? relay('balance') : post('/gateway/balance/', { merchant_sn: c.sn, sign: sign.balance(c) });
/** Verify an Afrstar callback signature (locally, or through the relay). */
export async function verifyCallback(c: C, kind: 'payin' | 'payout', b: any, amount: unknown): Promise<boolean> {
  const posn = String(b.platform_osn), st = String(b.status);
  if (c.relay) {
    const r = await relay('verify', { kind, platform_osn: posn, status: st, amount: money(amount), sign: String(b.sign || ''), merchant_sn: b.merchant_sn });
    return !!(r && r.valid && r.merchant_ok !== false);
  }
  if (b.merchant_sn !== undefined && String(b.merchant_sn).trim() !== c.sn) return false;
  const exp = kind === 'payin' ? sign.payinCallback(c, posn, st, amount) : sign.payoutCallback(c, posn, st, amount);
  return safeEqual(exp, String(b.sign || ''));
}
export async function egressIp() {
  if (RELAY_URL && RELAY_SECRET) { const r = await relay('ip'); if (r?.ip) return r.ip; }
  try { const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(2500) }); return (await r.json()).ip || null; } catch { return null; }
}
