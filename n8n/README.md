# n8n optional bonus: Order to HubSpot

These workflows are an independent optional n8n implementation for the Optima
Solutions Stage 2 bonus. They do **not** call the Express API, use PostgreSQL,
or depend on the application Docker Compose stack.

They were authored against the current upstream n8n built-in node schemas
checked on 2026-10-20:

- Webhook `2.2`
- Crypto `2`
- Code `2`
- If `2.2`
- HTTP Request `4.5`
- Respond to Webhook `1.5`
- Error Trigger `1`
- Send Email `2.1`

The workflows were imported and runtime-tested in a local n8n instance. The
repository exports have subsequently been sanitized: they contain no local
workflow IDs, n8n instance IDs, credential IDs, execution data, active state,
or saved Error Workflow ID. Reconfigure credentials and reselect the Error
Workflow after every import.

## Files

- `order-to-hubspot.json`: the independently hosted `POST` webhook and
  Contact/Deal sync flow.
- `error-notification.json`: an Error Trigger workflow that emits a minimal,
  sanitized SMTP alert when the main workflow fails automatically.

## Import and configure

1. In n8n, import `error-notification.json`, then import
   `order-to-hubspot.json`. Both sanitized exports import disabled.
2. Create a **Crypto** credential named `Webhook HMAC Secret`. Enter the
   shared webhook HMAC secret in its **Hmac Secret** field. Credentials are
   stored in n8n; neither workflow JSON contains a secret.
3. Create a **Bearer Auth** credential named `HubSpot Private App Token` and
   enter the HubSpot private-app token. It needs:

   - `crm.objects.contacts.read` and `crm.objects.contacts.write`
   - `crm.objects.deals.read` and `crm.objects.deals.write`

   Select this credential on all seven HubSpot HTTP Request nodes if n8n
   doesn't resolve the imported credential name automatically.
4. **Update Deal** and **Create Deal** intentionally use the verified HubSpot
   internal values `pipeline: default` and `dealstage: appointmentscheduled`.
   Change both nodes together only if the target portal uses different internal
   IDs. Do not put a token in either node.
5. Ensure the Deal property exists before activating the workflow:

   ```text
   Label:         External Order ID
   Internal name: external_order_id
   Field type:    Single-line text
   Group:         Deal Information
   Unique values: enabled
   ```

   Give the private app the schema scopes only if it is used to manage this
   setting outside the workflow. This workflow intentionally does not alter
   HubSpot schema.
6. In `error-notification.json`, configure a real SMTP credential named
   `Optima Operations SMTP`, and replace both `example.invalid` addresses in
   **Notify Operator by Email**. The alert includes only workflow/execution
   identifiers, node name, mode, and a bounded redacted message.
7. The sanitized main export intentionally has no local Error Workflow ID.
   Open **Optima Solutions - Order Created to HubSpot** → **Settings** →
   **Error workflow**, select **Optima Solutions - Order to HubSpot Error
   Notification**, then save. This reselect step is required after every
   import. Finally activate the main workflow and use its production webhook
   URL.

The Webhook node path is `optima-orders/order-created`; n8n supplies separate
test and production URLs. The production URL is registered only after the
workflow is activated.

## Request contract and responses

The endpoint accepts a JSON `POST` matching the assessment payload:

```json
{
  "event": "order.created",
  "order_id": "ORD-10482",
  "created_at": "2026-09-20T14:32:00+08:00",
  "customer": {
    "email": "maria.santos@example.com",
    "first_name": "Maria",
    "last_name": "Santos",
    "phone": "+639171234567"
  },
  "items": [{ "sku": "TSH-BLK-M", "name": "Black Tee (M)", "qty": 2, "price": 450.0 }],
  "currency": "PHP",
  "total": 900.0
}
```

It requires `X-Webhook-Signature: sha256=<hex>`, where `<hex>` is an
HMAC-SHA256 over the original HTTP body bytes using the HMAC secret.

| Outcome | HTTP response |
| --- | --- |
| Missing, malformed, or invalid signature | `401` with a generic error |
| Invalid `order.created` body | `400` with a generic error |
| Contact/Deal/association succeeds | `200` with only order ID, Contact ID, Deal ID, and `synchronized` |
| HubSpot or workflow error | The execution fails; n8n's normal error response applies and the configured Error Trigger can notify the operator |

The `items` fields are validated but intentionally aren't mapped to HubSpot;
that matches the existing backend mapping.

## Security behavior and caveats

The **Order Created Webhook** node enables **Raw Body**. In current n8n, this
preserves the raw incoming request bytes as binary property `data`. The
**HMAC SHA-256 Raw Body** Crypto node reads exactly that binary property and
uses the secret stored in the Crypto credential, not a workflow field.

**Timing-safe comparison is implemented.** The next Code node validates the
`sha256=<64 hex characters>` format, verifies equal byte lengths, and calls
Node's `crypto.timingSafeEqual`. It fails closed if the `crypto` module cannot
be loaded; it never falls back to an ordinary string comparison. n8n Cloud
makes the `crypto` module available to Code nodes. On self-hosted n8n, set the
least-privilege setting below (or the equivalent task-runner setting) before
testing:

```bash
NODE_FUNCTION_ALLOW_BUILTIN=crypto
```

Raw-body authentication remains sensitive to byte fidelity: configure any
reverse proxy or sender not to decompress, reserialize, trim, re-encode, or
otherwise rewrite the request body before n8n receives it. Send JSON with the
same UTF-8 bytes that were signed. Review n8n execution-data retention and
access controls as successful webhook executions necessarily contain customer
data; the error notification deliberately excludes the body, headers,
credentials, and customer fields.

The HubSpot bearer credential is never returned by the workflow or browser,
and default HTTP Request behavior is retained: a non-2xx HubSpot response
fails the execution instead of being silently converted into success.

## Idempotency and concurrency limitation

For a repeated **sequential** delivery, the workflow searches Contacts by
normalized email and Deals by the unique `external_order_id`, then updates the
existing objects and repeats the default association. This avoids a second
Deal in the normal replay path.

This is not a database transaction or durable queue. Two simultaneous n8n
executions for an unseen order can both search before either creates a Deal.
The unique HubSpot property is essential: normally one create wins and the
other receives a conflict and fails into the error workflow, but this export
does not yet retry/re-search that conflict. It therefore does **not** provide
the Express/PostgreSQL worker's concurrent idempotency, lease recovery, retry
policy, or sync-attempt history. Keep the main application as the production
path unless those operational guarantees are rebuilt in n8n.

## Verified runtime behavior

The following checks were completed against the local n8n instance and the
HubSpot test account before sanitizing these exports:

- Invalid HMAC returned HTTP `401`.
- Valid HMAC with an invalid payload returned HTTP `400`.
- A valid order returned HTTP `200`, created a HubSpot Deal, and associated it
  with the resolved Contact.
- Replaying the same order ID returned the same existing Deal ID (sequential
  idempotency).
- An automatic workflow failure produced the configured SMTP notification.

No live HubSpot request is made by repository validation commands. To perform
a future authorized live test, use the assessment-compatible payload and
calculate the HMAC from the exact file bytes. For example, replace the URL and
use an uncommitted local secret:

```bash
WEBHOOK_SIGNING_SECRET='replace-locally'
WEBHOOK_URL='https://your-n8n.example/webhook/optima-orders/order-created'
node -e "const fs=require('node:fs');const crypto=require('node:crypto');const body=fs.readFileSync('payload.json');const sig=crypto.createHmac('sha256',process.env.WEBHOOK_SIGNING_SECRET).update(body).digest('hex');fetch(process.env.WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json','x-webhook-signature':'sha256='+sig},body}).then(async r=>{console.log(r.status);console.log(await r.text())})"
```

For a future Error Trigger test, n8n does not run Error Trigger workflows for a
manual editor execution. Trigger the main workflow **automatically** through
its test/production webhook URL. In a copied, non-production workflow, point
one HubSpot HTTP Request node at a deliberately invalid local test URL (not a
HubSpot endpoint), invoke a valid signed automatic request, and confirm the
SMTP alert contains no webhook body or customer data. Restore the URL before
any live test.

## Export audit and static verification

- Parsed both JSON exports and verified every connection source/target exists.
- Reviewed current upstream built-in node definitions for Webhook raw-body
  binary output, Crypto HMAC credential/binary parameters, Code-node crypto
  support, HTTP bearer credentials, Respond to Webhook, and Error Trigger.
- Confirmed no HubSpot token, HMAC secret, SMTP password, personal email,
  credential ID, n8n instance ID, workflow ID, error-workflow ID, or execution
  data is present. The assessment's sample customer email and reserved
  `example.invalid` setup placeholders are documentation only.
- Verified that the generic credential names are only import-time prompts:
  `Webhook HMAC Secret`, `HubSpot Private App Token`, and
  `Optima Operations SMTP`.
- Verified both Deal write nodes use `pipeline: default` and
  `dealstage: appointmentscheduled`.

The actual n8n import, HMAC/payload cases, CRM sync/association, sequential
replay, and automatic SMTP alert were runtime-verified as listed above. A
fresh import after sanitization still needs the credential binding, Error
Workflow selection, and an authorized live test in its target n8n instance.
