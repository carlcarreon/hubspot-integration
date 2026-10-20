import { createHmac, timingSafeEqual } from 'node:crypto';

const signaturePattern = /^sha256=([a-f0-9]{64})$/;

export class WebhookSignatureService {
  constructor(private readonly signingSecret: string) {}

  verify(rawBody: Buffer, providedSignature: string | undefined): boolean {
    if (!providedSignature) {
      return false;
    }

    const match = signaturePattern.exec(providedSignature);
    if (!match) {
      return false;
    }

    const expected = createHmac('sha256', this.signingSecret).update(rawBody).digest();
    const received = Buffer.from(match[1], 'hex');

    return received.length === expected.length && timingSafeEqual(received, expected);
  }
}
