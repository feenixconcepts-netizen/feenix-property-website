const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const env = context.env;
  const secret = env.PAYSTACK_SECRET_KEY;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !key || !env.SUPABASE_URL) {
    return json({ ok: false, error: 'Server configuration error.' }, 500);
  }

  const auth = context.request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ ok: false, error: 'Not signed in.' }, 401);

  const base = env.SUPABASE_URL.replace(/\/+$/, '');

  const userRes = await fetch(base + '/auth/v1/user', {
    headers: { apikey: key, Authorization: 'Bearer ' + token }
  });
  if (!userRes.ok) return json({ ok: false, error: 'Not signed in.' }, 401);
  const user = await userRes.json();
  const email = String((user && user.email) || '').trim().toLowerCase();
  if (!email) return json({ ok: false, error: 'No email on this account.' }, 400);

  const sb = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) sb.Authorization = 'Bearer ' + key;

  const rowRes = await fetch(
    base + '/rest/v1/subscriptions?email=eq.' + encodeURIComponent(email) + '&select=status,paystack_subscription_code',
    { headers: sb }
  );
  if (!rowRes.ok) return json({ ok: false, error: 'Could not read subscription.' }, 502);
  const rows = await rowRes.json();
  const row = rows && rows[0];
  if (!row || !row.paystack_subscription_code) {
    return json({ ok: true, changed: false, message: 'There is no paid subscription to stop.' });
  }
  if (row.status === 'non_renewing' || row.status === 'cancelled') {
    return json({ ok: true, changed: false, message: 'Renewal is already stopped.' });
  }

  const code = row.paystack_subscription_code;
  const ps = { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' };

  const infoRes = await fetch('https://api.paystack.co/subscription/' + encodeURIComponent(code), { headers: ps });
  const info = await infoRes.json().catch(function () { return {}; });
  const emailToken = info && info.data && info.data.email_token;
  if (!infoRes.ok || !emailToken) {
    return json({ ok: false, error: 'Could not reach the subscription. Please email support.' }, 502);
  }

  const disRes = await fetch('https://api.paystack.co/subscription/disable', {
    method: 'POST',
    headers: ps,
    body: JSON.stringify({ code: code, token: emailToken })
  });
  if (!disRes.ok) {
    return json({ ok: false, error: 'Paystack could not stop the renewal. Please email support.' }, 502);
  }

  await fetch(base + '/rest/v1/subscriptions?email=eq.' + encodeURIComponent(email), {
    method: 'PATCH',
    headers: Object.assign({ Prefer: 'return=minimal' }, sb),
    body: JSON.stringify(Object.assign({ status: 'non_renewing', updated_at: new Date().toISOString() }, (info.data && info.data.next_payment_date) ? { next_payment_date: info.data.next_payment_date } : {}))
  });

  return json({ ok: true, changed: true, message: 'Renewal stopped. Your access continues until the end of the period you paid for.' });
}
