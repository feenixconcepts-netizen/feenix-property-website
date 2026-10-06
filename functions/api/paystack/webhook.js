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

  // Acknowledge valid Paystack events. Persistent subscription state will be
  // connected to the application's data store in the next backend stage.
  console.log(JSON.stringify({
    source: 'paystack',
    event: event?.event || null,
    reference: event?.data?.reference || null,
    customer: event?.data?.customer?.email || null,
    receivedAt: new Date().toISOString()
  }));

  return new Response('OK', { status: 200 });
}
