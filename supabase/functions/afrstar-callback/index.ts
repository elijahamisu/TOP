// Afrstar webhooks. Configure in the Afrstar merchant portal:
//   Collection callback: <SUPABASE_URL>/functions/v1/afrstar-callback?type=payin
//   Payout callback:     <SUPABASE_URL>/functions/v1/afrstar-callback?type=payout
// Answers exactly "success" (HTTP 200) only after verifying and persisting.
import { db, getConfig, sign, safeEqual, money, orderKind } from '../_shared/afrstar.ts';

const txt = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

async function readBody(req: Request) {
  const raw = (await req.text()).trim();
  try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}
async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return txt(405, 'method not allowed');
  const type = new URL(req.url).searchParams.get('type') || '';
  const config = getConfig();
  if (!config.ok) return txt(500, 'gateway not configured');
  try {
    const b: any = await readBody(req);
    const orderSn = String(b.order_sn || '').trim(), posn = String(b.platform_osn || '').trim();
    const status = b.status === undefined || b.status === null ? '' : String(b.status).trim();
    const sig = String(b.sign || '').trim();
    if (!orderSn || !posn || status === '' || !sig) return txt(400, 'missing fields');
    if (b.merchant_sn !== undefined && String(b.merchant_sn).trim() !== config.sn) return txt(400, 'merchant mismatch');
    const kind = orderKind(orderSn);
    const base = { p_order_sn: orderSn, p_platform_osn: posn, p_status: Number(status), p_message: b.message ? String(b.message).slice(0, 500) : null, p_payload: b };

    if (type === 'payin' || kind === 'USER_DEPOSIT' || kind === 'ADMIN_TOPUP') {
      let original: unknown;
      if (kind === 'USER_DEPOSIT') {
        const { data } = await db.from('deposits').select('order_amount').eq('order_sn', orderSn).maybeSingle();
        if (!data) return txt(404, 'order not found'); original = data.order_amount;
      } else if (kind === 'ADMIN_TOPUP') {
        const { data } = await db.from('gateway_admin_transactions').select('amount').eq('order_sn', orderSn).maybeSingle();
        if (!data) return txt(404, 'order not found'); original = data.amount;
      } else return txt(404, 'order not found');
      if (!safeEqual(sign.payinCallback(config, posn, status, original), sig)) return txt(401, 'invalid signature');
      const utr = b.utr ? String(b.utr).slice(0, 120) : (b.session_id ? String(b.session_id).slice(0, 120) : null);
      const paid = num(b.amount_paid) ?? num(b.amount);
      const r = kind === 'USER_DEPOSIT'
        ? await rpc('gw_apply_payin', { ...base, p_amount_paid: paid, p_utr: utr })
        : await rpc('gw_apply_admin', { ...base, p_amount: paid, p_utr: utr });
      if (r === 'not_found') return txt(404, 'order not found');
      if (r === 'osn_mismatch') return txt(409, 'platform order mismatch');
      return txt(200, 'success');
    }

    if (type === 'payout' || kind === 'USER_WITHDRAWAL' || kind === 'ADMIN_PAYOUT') {
      if (b.amount === undefined || b.amount === '' || b.amount === null) return txt(400, 'missing amount');
      const amt = money(b.amount);
      if (!safeEqual(sign.payoutCallback(config, posn, status, amt), sig)) return txt(401, 'invalid signature');
      const utr = b.utr ? String(b.utr).slice(0, 120) : null;
      let r: string;
      if (kind === 'USER_WITHDRAWAL') r = await rpc('gw_apply_payout', { ...base, p_amount: Number(amt), p_utr: utr });
      else if (kind === 'ADMIN_PAYOUT') {
        const { data } = await db.from('gateway_admin_transactions').select('amount').eq('order_sn', orderSn).maybeSingle();
        if (!data) return txt(404, 'order not found');
        if (money(data.amount) !== amt) return txt(409, 'amount mismatch');
        r = await rpc('gw_apply_admin', { ...base, p_amount: Number(amt), p_utr: utr });
      } else return txt(404, 'order not found');
      if (r === 'not_found') return txt(404, 'order not found');
      if (r === 'osn_mismatch' || r === 'amount_mismatch') return txt(409, r);
      return txt(200, 'success');
    }
    return txt(404, 'order not found');
  } catch (e) {
    console.error('afrstar-callback error', e);
    return txt(500, 'error');
  }
});
