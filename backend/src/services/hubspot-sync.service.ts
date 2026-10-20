import type { ClaimedSyncJob, SyncJobRepository } from '../repositories/sync-job.repository.js';
import {
  type HubSpotClient,
  type HubSpotContactInput,
  type HubSpotDealInput,
} from './hubspot-client.service.js';
import {
  orderCreatedWebhookSchema,
  type OrderCreatedWebhook,
} from '../validators/order-webhook.validator.js';

export type HubSpotSyncConfiguration = {
  pipelineId: string;
  dealStageId: string;
};

export class HubSpotSyncService {
  constructor(
    private readonly hubSpotClient: HubSpotClient,
    private readonly syncJobRepository: SyncJobRepository,
    private readonly configuration: HubSpotSyncConfiguration,
  ) {}

  async verifySetup(): Promise<void> {
    await this.hubSpotClient.ensureExternalOrderIdProperty();
  }

  async synchronize(job: ClaimedSyncJob): Promise<void> {
    const payload = orderCreatedWebhookSchema.parse(job.order.payload);
    const contactInput: HubSpotContactInput = {
      email: payload.customer.email.trim().toLowerCase(),
      firstName: payload.customer.first_name,
      lastName: payload.customer.last_name,
      phone: payload.customer.phone,
    };

    const contactId = await this.synchronizeContact(job, contactInput);
    await this.syncJobRepository.saveHubSpotIds(job.order.id, { contactId });

    const dealInput = toDealInput(payload, this.configuration);
    const dealId = await this.synchronizeDeal(job, dealInput);
    await this.syncJobRepository.saveHubSpotIds(job.order.id, { dealId });

    // The dated default-association endpoint is idempotent, allowing an
    // interrupted run to repeat this final step without duplicate records.
    await this.hubSpotClient.associateDealWithContact(dealId, contactId);
  }

  private async synchronizeContact(job: ClaimedSyncJob, input: HubSpotContactInput): Promise<string> {
    if (job.order.hubspotContactId) {
      await this.hubSpotClient.updateContact(job.order.hubspotContactId, input);
      return job.order.hubspotContactId;
    }

    const existingId = await this.hubSpotClient.findContactByEmail(input.email);
    if (existingId) {
      await this.hubSpotClient.updateContact(existingId, input);
      return existingId;
    }

    return this.hubSpotClient.createContact(input);
  }

  private async synchronizeDeal(job: ClaimedSyncJob, input: HubSpotDealInput): Promise<string> {
    if (job.order.hubspotDealId) {
      await this.hubSpotClient.updateDeal(job.order.hubspotDealId, input);
      return job.order.hubspotDealId;
    }

    // Search before create is critical when a prior create succeeded but the
    // response or local ID persistence was interrupted.
    const existingId = await this.hubSpotClient.findDealByExternalOrderId(input.externalOrderId);
    if (existingId) {
      await this.hubSpotClient.updateDeal(existingId, input);
      return existingId;
    }

    return this.hubSpotClient.createDeal(input);
  }
}

function toDealInput(
  payload: OrderCreatedWebhook,
  configuration: HubSpotSyncConfiguration,
): HubSpotDealInput {
  return {
    externalOrderId: payload.order_id,
    dealName: `Order ${payload.order_id} - ${payload.customer.first_name} ${payload.customer.last_name}`,
    amount: payload.total.toFixed(2),
    currency: payload.currency,
    closeDate: new Date(payload.created_at).toISOString(),
    pipelineId: configuration.pipelineId,
    dealStageId: configuration.dealStageId,
  };
}
