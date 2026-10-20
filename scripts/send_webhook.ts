import { createHmac } from 'node:crypto';

async function main(): Promise<void> {
  const signingSecret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!signingSecret || signingSecret.length < 16) {
    throw new Error('WEBHOOK_SIGNING_SECRET must be set to a value of at least 16 characters.');
  }

  const endpoint = process.argv[2] ?? 'http://localhost:3000/api/webhooks/orders';
  const payload = {
    event: 'order.created',
    order_id: `ORD-DEMO-${Date.now()}`,
    created_at: new Date().toISOString(),
    customer: {
      email: 'maria.santos@example.com',
      first_name: 'Maria',
      last_name: 'Santos',
      phone: '+639171234567',
    },
    items: [
      { sku: 'TSH-BLK-M', name: 'Black Tee (M)', qty: 2, price: 450 },
    ],
    currency: 'PHP',
    total: 900,
  };
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', signingSecret).update(rawBody).digest('hex');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${signature}`,
    },
    body: rawBody,
  });

  console.info(`POST ${endpoint} -> ${response.status}`);
  console.info(await response.text());
  if (!response.ok) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unable to send webhook.';
  console.error(message);
  process.exitCode = 1;
});
