// TOP <-> Afrstar actions called from the browser (Bearer = the user's Supabase JWT).
//   user:  { action: 'deposit', amount }                         -> { pay_url }
//   admin: { action: 'status' }                                  -> configured?, balance, callback urls
//          { action: 'topup', amount, phone? }                   -> { pay_url }  (funds the gateway, no wallet credit)
//          { action: 'payout', amount, bank_code, account_number, account_name }  (withdraw gateway funds)
//          { action: 'send_withdrawal', id, bank_code? }         (approve a user withdrawal via Afrstar payout)
import { db, getConfig, getBalance, createPayin, createPayout, makeOrderSn, money, egressIp, PREFIX } from '../_shared/afrstar.ts';
import { bankByCode, guessBankCode } from '../_shared/ng-banks.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const SITE = (Deno.env.get('PUBLIC_SITE_URL') || 'https://top-omega-kohl.vercel.app').replace(/\/+$/, '');
const CALLBACK_BASE = `${Deno.env.get('SUPABASE_URL')}/functions/v1/afrstar-callback`;

function siteUrl(req: Request) {
  const o = req.headers.get('origin');
  return o && /^https:\/\//.test(o) ? o.replace(/\/+$/, '') : SITE;
}
async function gwError(message: string, extra: Record<string, unknown> = {}) {
  const ip = await egressIp();
  return json(502, { error: message, server_ip: ip, ...extra });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return json(401, { error: 'Please sign in again.' });
    const { data: profile } = await db.from('profiles').select('id, full_name, email, phone, is_admin, status').eq('id', user.id).single();
    if (!profile) return json(401, { error: 'Profile not found.' });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const config = getConfig();

    if (action === 'deposit') {
      if (!config.ok) return json(503, { error: 'Online payment is not available right now. Please use bank transfer.' });
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json(400, { error: 'Enter a valid amount.' });
      const orderSn = makeOrderSn(PREFIX.USER_DEPOSIT);
      const { error: cErr } = await db.rpc('gw_create_deposit', { p_user: user.id, p_amount: Number(money(amount)), p_order_sn: orderSn });
      if (cErr) return json(400, { error: cErr.message });
      const phone = String(profile.phone || '').replace(/[^\d]/g, '') || '08000000000';
      const r = await createPayin(config, {
        orderSn, amount, name: profile.full_name || 'TOP User', email: profile.email || user.email || '', phone,
        remark: 'TOP wallet deposit', redirectUrl: `${siteUrl(req)}/deposit.html?gateway=${encodeURIComponent(orderSn)}`,
      });
      if (!r.ok || !r.data?.pay_url) {
        const msg = r.ok ? 'Gateway did not return a payment link.' : r.message;
        await db.rpc('gw_fail_deposit', { p_order_sn: orderSn, p_message: msg });
        return json(502, { error: 'Could not start the payment. Please try again shortly.' });
      }
      await db.from('deposits').update({ platform_osn: r.data.platform_osn || null, pay_url: r.data.pay_url, gateway_message: 'Awaiting payment' }).eq('order_sn', orderSn);
      return json(200, { ok: true, order_sn: orderSn, pay_url: r.data.pay_url });
    }

    // ---- admin only below ----
    if (!profile.is_admin) return json(403, { error: 'Administrator access required.' });

    if (action === 'status') {
      const callbacks = { payin: `${CALLBACK_BASE}?type=payin`, payout: `${CALLBACK_BASE}?type=payout` };
      if (!config.ok) return json(200, { configured: false, callbacks, server_ip: await egressIp() });
      const r = await getBalance(config);
      if (!r.ok) return json(200, { configured: true, balance: null, error: r.message, callbacks, server_ip: await egressIp() });
      const bal = Number(r.data?.balance);
      return json(200, { configured: true, balance: Number.isFinite(bal) ? bal : null, fetched_at: new Date().toISOString(), callbacks });
    }
    if (!config.ok) return json(503, { error: config.error, code: 'gateway_not_configured' });

    if (action === 'topup') {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json(400, { error: 'Enter a valid amount.' });
      const phone = String(body.phone || profile.phone || '').replace(/[^\d]/g, '');
      if (phone.length < 10) return json(400, { error: 'Enter a phone number for the checkout.', code: 'phone_required' });
      const orderSn = makeOrderSn(PREFIX.ADMIN_TOPUP);
      const { data: row, error } = await db.from('gateway_admin_transactions').insert([{ kind: 'topup', order_sn: orderSn, amount: Number(money(amount)), status: 'pending', created_by: user.id, gateway_message: 'Creating checkout…' }]).select('id').single();
      if (error) throw error;
      const r = await createPayin(config, { orderSn, amount, name: profile.full_name || 'TOP Admin', email: profile.email || user.email || '', phone, remark: 'Gateway top-up', redirectUrl: `${siteUrl(req)}/admin/gateway.html?topup=${encodeURIComponent(orderSn)}` });
      if (!r.ok || !r.data?.pay_url) {
        const msg = r.ok ? 'Gateway did not return a payment link.' : r.message;
        await db.from('gateway_admin_transactions').update({ status: 'failed', gateway_message: msg, updated_at: new Date().toISOString() }).eq('id', row.id);
        return gwError(msg);
      }
      await db.from('gateway_admin_transactions').update({ platform_osn: r.data.platform_osn || null, pay_url: r.data.pay_url, gateway_message: 'Awaiting payment', updated_at: new Date().toISOString() }).eq('id', row.id);
      await db.from('admin_logs').insert([{ admin_id: user.id, admin_name: profile.full_name, action: `Started gateway top-up ₦${money(amount)}`, target_id: orderSn }]);
      return json(200, { ok: true, order_sn: orderSn, pay_url: r.data.pay_url });
    }

    if (action === 'payout') {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json(400, { error: 'Enter a valid amount.' });
      const bank = bankByCode(body.bank_code);
      if (!bank) return json(400, { error: 'Choose a bank from the list.' });
      const account = String(body.account_number || '').replace(/\s+/g, '');
      if (!/^\d{10}$/.test(account)) return json(400, { error: 'Account number must be 10 digits.' });
      const name = String(body.account_name || '').trim();
      if (name.length < 2) return json(400, { error: 'Enter the account holder name.' });
      const b = await getBalance(config);
      if (!b.ok) return gwError(b.message);
      const balance = Number(b.data?.balance);
      if (Number.isFinite(balance) && amount > balance) return json(422, { error: `Insufficient gateway balance: ₦${money(balance)} available.` });
      const orderSn = makeOrderSn(PREFIX.ADMIN_PAYOUT);
      const { data: row, error } = await db.from('gateway_admin_transactions').insert([{ kind: 'payout', order_sn: orderSn, amount: Number(money(amount)), balance_before: Number.isFinite(balance) ? balance : null, bank_code: bank.code, bank_name: bank.name, account_number: account, account_name: name, status: 'processing', gateway_message: 'Sending to gateway…', created_by: user.id }]).select('id').single();
      if (error) throw error;
      const r = await createPayout(config, { orderSn, amount, name, account, bankCode: bank.code, remark: 'TOP admin withdrawal' });
      await db.from('admin_logs').insert([{ admin_id: user.id, admin_name: profile.full_name, action: `Gateway withdrawal ₦${money(amount)} to ${bank.name} ${account}`, target_id: orderSn }]);
      if (r.ok) {
        await db.from('gateway_admin_transactions').update({ platform_osn: r.data.platform_osn || null, gateway_message: `Accepted by gateway (${r.data.status || 'init'})`, updated_at: new Date().toISOString() }).eq('id', row.id);
        return json(200, { ok: true, order_sn: orderSn });
      }
      await db.from('gateway_admin_transactions').update({ status: r.definitive ? 'failed' : 'processing', gateway_message: r.message, updated_at: new Date().toISOString() }).eq('id', row.id);
      return gwError(r.definitive ? r.message : `${r.message} The payout may or may not have been created; wait for the callback.`);
    }

    if (action === 'send_withdrawal') {
      const { data: w } = await db.from('withdrawals').select('id, status, bank_name, account_number, account_name').eq('id', body.id).maybeSingle();
      if (!w) return json(404, { error: 'Withdrawal not found.' });
      if (w.status !== 'pending') return json(409, { error: `Withdrawal is already ${w.status}.` });
      const bank = bankByCode(String(body.bank_code || guessBankCode(w.bank_name) || ''));
      if (!bank) return json(422, { error: `Choose the bank for "${w.bank_name || 'this account'}" before sending.`, code: 'bank_code_required' });
      const account = String(w.account_number || '').replace(/\s+/g, '');
      if (!/^\d{10}$/.test(account)) return json(422, { error: `Account number "${w.account_number || ''}" is not 10 digits. Mark as paid or reject instead.` });
      if (!String(w.account_name || '').trim()) return json(422, { error: 'Account holder name is missing.' });
      const orderSn = makeOrderSn(PREFIX.USER_WITHDRAWAL);
      const { data: claim, error: cErr } = await db.rpc('gw_claim_withdrawal', { p_id: w.id, p_admin: user.id, p_order_sn: orderSn, p_bank_code: bank.code });
      if (cErr) return json(409, { error: cErr.message });
      const net = Number((claim as any).payout_amount);
      const r = await createPayout(config, { orderSn, amount: net, name: String(w.account_name).trim(), account, bankCode: bank.code, remark: 'TOP withdrawal' });
      if (r.ok) {
        await db.rpc('gw_set_withdrawal_osn', { p_id: w.id, p_platform_osn: r.data.platform_osn || null, p_message: `Accepted by gateway (${r.data.status || 'init'})` });
        return json(200, { ok: true, status: 'processing', order_sn: orderSn, amount: money(net) });
      }
      if (r.definitive) {
        await db.rpc('gw_revert_withdrawal', { p_id: w.id, p_message: `Gateway refused: ${r.message}` });
        return gwError(r.message, { status: 'pending' });
      }
      await db.rpc('gw_set_withdrawal_osn', { p_id: w.id, p_platform_osn: null, p_message: `${r.message} Outcome unknown (order ${orderSn}); wait for the gateway callback.` });
      return gwError(`${r.message} The payout may or may not have been created (order ${orderSn}). Wait for the gateway callback.`, { status: 'processing' });
    }

    return json(400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('afrstar fn error', e);
    return json(500, { error: (e as Error).message || 'Internal error' });
  }
});
