export async function onRequestPost(context) {
  const origin = context.request.headers.get('Origin');
  const allowedOrigin = new URL(context.request.url).origin;

  if (origin && origin !== allowedOrigin) {
    return new Response(JSON.stringify({ status: false, message: 'Origin not allowed.' }), {
      status: 403,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ status: false, message: 'Invalid JSON.' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
  if (!reference || !/^[A-Za-z0-9._-]{1,100}$/.test(reference)) {
    return new Response(JSON.stringify({ status: false, message: 'A valid transaction reference is required.' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const secret = context.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return new Response(JSON.stringify({ status: false, message: 'Paystack server configuration is incomplete.' }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json'
    }
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.status) {
    return new Response(JSON.stringify({
      status: false,
      message: data?.message || 'Paystack transaction verification failed.'
    }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const transaction = data.data || {};
  return new Response(JSON.stringify({
    status: true,
    verified: transaction.status === 'success',
    reference: transaction.reference || reference,
    transactionStatus: transaction.status || null,
    amount: transaction.amount ?? null,
    currency: transaction.currency || null,
    planCode: transaction.plan?.plan_code || null,
    customerEmail: transaction.customer?.email || null
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
