async function hmacSha512Hex(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function mapEvent(event) {
  const d = event?.data || {};
  const email = d.customer?.email;
  switch (event?.event) {
    case 'charge.success':
      if (!d.plan?.plan_code) return null;
      return {
        email,
        status: 'active',
        plan_code: d.plan.plan_code,
        plan_name: d.plan.name,
        paystack_customer_code: d.customer?.customer_code,
        last_reference: d.reference
      };
    case 'subscription.create':
      return {
        email,
        status: 'active',
        plan_code: d.plan?.plan_code,
        plan_name: d.plan?.name,
        paystack_customer_code: d.customer?.customer_code,
        paystack_subscription_code: d.subscription_code,
        next_payment_date: d.next_payment_date
      };
    case 'invoice.update':
      if (!(d.paid === true || d.status === 'success')) return null;
      return {
        email,
        status: 'active',
        paystack_subscription_code: d.subscription?.subscription_code,
        next_payment_date: d.subscription?.next_payment_date
      };
    case 'invoice.payment_failed':
      return {
        email,
        status: 'past_due',
        paystack_subscription_code: d.subscription?.subscription_code
      };
    case 'subscription.not_renew':
      return {
        email,
        status: 'non_renewing',
        paystack_subscription_code: d.subscription_code,
        next_payment_date: d.next_payment_date
      };
    case 'subscription.disable':
      return {
        email,
        status: 'cancelled',
        paystack_subscription_code: d.subscription_code
      };
    default:
      return null;
  }
}

async function saveSubscription(env, fields) {
  const email = String(fields.email || '').trim().toLowerCase();
  if (!email) return;
  const row = { email, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (k !== 'email' && v !== undefined && v !== null && v !== '') row[k] = v;
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    'Content-Type': 'application/json',
    apikey: key,
    Prefer: 'resolution=merge-duplicates,return=minimal'
  };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  const url = env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/subscriptions?on_conflict=email';
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(row) });
  if (!res.ok) {
    throw new Error('Supabase ' + res.status + ': ' + (await res.text()).slice(0, 300));
  }
}

export async function onRequestPost(context) {
  const secret = context.env.PAYSTACK_SECRET_KEY;
  if (!secret) return new Response('Server configuration error.', { status: 500 });

  const rawBody = await context.request.text();
  const signature = context.request.headers.get('x-paystack-signature') || '';
  const expected = await hmacSha512Hex(secret, rawBody);

  if (!signature || !timingSafeEqual(signature.toLowerCase(), expected)) {
    return new Response('Invalid signature.', { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON.', { status: 400 });
  }

  console.log(JSON.stringify({
    source: 'paystack',
    event: event?.event || null,
    reference: event?.data?.reference || null,
    customer: event?.data?.customer?.email || null,
    receivedAt: new Date().toISOString()
  }));

  const fields = mapEvent(event);
  if (fields) {
    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response('Server configuration error.', { status: 500 });
    }
    try {
      await saveSubscription(context.env, fields);
    } catch (err) {
      console.error(String(err));
      return new Response('Save failed.', { status: 500 });
    }
  }

  return new Response('OK', { status: 200 });
}
