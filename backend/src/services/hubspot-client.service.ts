const apiVersion = '2026-09';
const apiBaseUrl = 'https://api.hubapi.com';
const externalOrderIdProperty = 'external_order_id';

export type HubSpotContactInput = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
};

export type HubSpotDealInput = {
  externalOrderId: string;
  dealName: string;
  amount: string;
  currency: string;
  closeDate: string;
  pipelineId: string;
  dealStageId: string;
};

export interface HubSpotClient {
  ensureExternalOrderIdProperty(): Promise<void>;
  findContactByEmail(email: string): Promise<string | null>;
  createContact(input: HubSpotContactInput): Promise<string>;
  updateContact(contactId: string, input: HubSpotContactInput): Promise<void>;
  findDealByExternalOrderId(externalOrderId: string): Promise<string | null>;
  createDeal(input: HubSpotDealInput): Promise<string>;
  updateDeal(dealId: string, input: HubSpotDealInput): Promise<void>;
  associateDealWithContact(dealId: string, contactId: string): Promise<void>;
}

export type HubSpotErrorMetadata = {
  category?: string;
  correlationId?: string;
  codes: string[];
  messages: string[];
  retryAfterMs?: number;
};

export class HubSpotApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly metadata: HubSpotErrorMetadata,
  ) {
    super(formatHubSpotErrorMessage(status, metadata));
    this.name = 'HubSpotApiError';
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export class HubSpotTransportError extends Error {
  readonly retryable = true;

  constructor(cause: unknown) {
    super('HubSpot network request failed.', { cause });
    this.name = 'HubSpotTransportError';
  }
}

export class HubSpotHttpClient implements HubSpotClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async ensureExternalOrderIdProperty(): Promise<void> {
    try {
      const property = await this.request<{ hasUniqueValue?: boolean }>(
        `/crm/properties/${apiVersion}/deals/${externalOrderIdProperty}`,
      );
      this.assertUniqueExternalOrderIdProperty(property.hasUniqueValue);
      return;
    } catch (error) {
      if (error instanceof HubSpotApiError && error.status === 403) {
        throw new Error(
          'HubSpot token cannot read Deal property schemas. Grant crm.schemas.deals.read '
          + 'and crm.schemas.deals.write to the private app, then restart the worker.',
          { cause: error },
        );
      }
      if (!(error instanceof HubSpotApiError) || error.status !== 404) {
        throw error;
      }
    }

    try {
      const property = await this.request<{ hasUniqueValue?: boolean }>(
        `/crm/properties/${apiVersion}/deals`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: externalOrderIdProperty,
            label: 'External Order ID',
            type: 'string',
            fieldType: 'text',
            groupName: 'dealinformation',
            hasUniqueValue: true,
          }),
        },
      );
      this.assertUniqueExternalOrderIdProperty(property.hasUniqueValue);
    } catch (error) {
      // A concurrent worker or deployment may create it first. Re-read rather
      // than assuming a 409 property uses the required unique constraint.
      if (!(error instanceof HubSpotApiError) || error.status !== 409) {
        throw error;
      }
      const property = await this.request<{ hasUniqueValue?: boolean }>(
        `/crm/properties/${apiVersion}/deals/${externalOrderIdProperty}`,
      );
      this.assertUniqueExternalOrderIdProperty(property.hasUniqueValue);
    }
  }

  async findContactByEmail(email: string): Promise<string | null> {
    return this.searchFirstId('contacts', 'email', email);
  }

  async createContact(input: HubSpotContactInput): Promise<string> {
    const result = await this.request<{ id?: string }>(`/crm/objects/${apiVersion}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ properties: contactProperties(input) }),
    });
    return requireId(result, 'contact create');
  }

  async updateContact(contactId: string, input: HubSpotContactInput): Promise<void> {
    await this.request(`/crm/objects/${apiVersion}/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: contactProperties(input) }),
    });
  }

  async findDealByExternalOrderId(externalOrderId: string): Promise<string | null> {
    return this.searchFirstId('deals', externalOrderIdProperty, externalOrderId);
  }

  async createDeal(input: HubSpotDealInput): Promise<string> {
    const result = await this.request<{ id?: string }>(`/crm/objects/${apiVersion}/deals`, {
      method: 'POST',
      body: JSON.stringify({ properties: dealProperties(input) }),
    });
    return requireId(result, 'deal create');
  }

  async updateDeal(dealId: string, input: HubSpotDealInput): Promise<void> {
    await this.request(`/crm/objects/${apiVersion}/deals/${encodeURIComponent(dealId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: dealProperties(input) }),
    });
  }

  async associateDealWithContact(dealId: string, contactId: string): Promise<void> {
    await this.request(
      `/crm/objects/${apiVersion}/deals/${encodeURIComponent(dealId)}`
        + `/associations/default/contacts/${encodeURIComponent(contactId)}`,
      { method: 'PUT' },
    );
  }

  private async searchFirstId(
    objectType: 'contacts' | 'deals',
    propertyName: string,
    value: string,
  ): Promise<string | null> {
    const result = await this.request<{ results?: Array<{ id?: string }> }>(
      `/crm/objects/${apiVersion}/${objectType}/search`,
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName, operator: 'EQ', value }] }],
          limit: 1,
        }),
      },
    );

    const id = result.results?.[0]?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  private assertUniqueExternalOrderIdProperty(hasUniqueValue: boolean | undefined): void {
    if (hasUniqueValue !== true) {
      throw new Error(
        'HubSpot deal property external_order_id exists but is not unique. '
        + 'Configure it as a unique single-line text property before starting the worker.',
      );
    }
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new HubSpotTransportError(error);
    }

    const text = await response.text();

    if (!response.ok) {
      const metadata = parseHubSpotErrorMetadata(text, response.headers.get('retry-after'));

      console.error('HubSpot API failure:', {
        method: init.method ?? 'GET',
        path,
        status: response.status,
        category: metadata.category,
        correlationId: metadata.correlationId,
        codes: metadata.codes,
      });

      throw new HubSpotApiError(response.status, metadata);
    }

    return text.length === 0 ? (undefined as T) : JSON.parse(text) as T;
  }
}

function parseHubSpotErrorMetadata(body: string, retryAfter: string | null): HubSpotErrorMetadata {
  const retryAfterMs = parseRetryAfter(retryAfter);
  const metadata: HubSpotErrorMetadata = {
    codes: [],
    messages: [],
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };

  if (body.length === 0) {
    return metadata;
  }

  try {
    const error = JSON.parse(body) as {
      category?: unknown;
      message?: unknown;
      correlationId?: unknown;
      errors?: Array<{ code?: unknown; message?: unknown }>;
    };
    if (typeof error.category === 'string') {
      metadata.category = sanitizeHubSpotDiagnostic(error.category);
    }
    if (typeof error.correlationId === 'string') {
      metadata.correlationId = sanitizeHubSpotDiagnostic(error.correlationId);
    }
    if (typeof error.message === 'string') {
      metadata.messages.push(sanitizeHubSpotDiagnostic(error.message));
    }
    for (const item of error.errors ?? []) {
      if (typeof item.code === 'string') {
        metadata.codes.push(sanitizeHubSpotDiagnostic(item.code));
      }
      if (typeof item.message === 'string') {
        metadata.messages.push(sanitizeHubSpotDiagnostic(item.message));
      }
    }
  } catch {
    metadata.messages.push('HubSpot returned a non-JSON error response.');
  }

  metadata.codes = [...new Set(metadata.codes)].slice(0, 5);
  metadata.messages = [...new Set(metadata.messages)].slice(0, 3);
  return metadata;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const millisecondsUntilDate = Date.parse(value) - Date.now();
  return Number.isFinite(millisecondsUntilDate) && millisecondsUntilDate >= 0
    ? millisecondsUntilDate
    : undefined;
}

function sanitizeHubSpotDiagnostic(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 500);
}

function formatHubSpotErrorMessage(status: number, metadata: HubSpotErrorMetadata): string {
  const context = [
    metadata.category,
    metadata.correlationId ? `correlationId=${metadata.correlationId}` : undefined,
    ...metadata.codes,
    ...metadata.messages,
  ].filter((value): value is string => Boolean(value));
  return `HubSpot request failed with status ${status}.${context.length > 0 ? ` ${context.join('; ')}` : ''}`;
}

function contactProperties(input: HubSpotContactInput): Record<string, string> {
  return {
    email: input.email,
    firstname: input.firstName,
    lastname: input.lastName,
    phone: input.phone,
  };
}

function dealProperties(input: HubSpotDealInput): Record<string, string> {
  return {
    external_order_id: input.externalOrderId,
    dealname: input.dealName,
    amount: input.amount,
    deal_currency_code: input.currency,
    closedate: input.closeDate,
    pipeline: input.pipelineId,
    dealstage: input.dealStageId,
  };
}

function requireId(result: { id?: string }, operation: string): string {
  if (!result.id) {
    throw new Error(`HubSpot ${operation} response did not include an ID.`);
  }
  return result.id;
}
