import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksLikePlaceholderStub,
  looksLikeTutorialProse,
  looksLikeToolCallJsonLeak,
  stripBrokenJsonTail,
  validateWriteContents,
  sanitizeFileContents,
} from './sanitize-code.js';
import { inferNewServicePath } from './service-path.js';

describe('inferNewServicePath', () => {
  it('infers shared booking-api-client service path', () => {
    const p = inferNewServicePath('add new shared service for booking-api-client');
    assert.equal(p, 'shared/booking-api-client.service.ts');
  });

  it('infers path from "create new booking-client-api shared service"', () => {
    const p = inferNewServicePath('create new booking-client-api shared service');
    assert.equal(p, 'shared/booking-client-api.service.ts');
  });
});

describe('dynamic tutorial detection', () => {
  it('flags numbered-step guides without exact phrase list', () => {
    const t =
      'To create a new shared service called booking-api-client, you can follow these steps:\n\n' +
      '1. Generate the Shared Library using Nx\n' +
      '2. Update package.json dependencies\n' +
      '3. Create the service implementation\n\n' +
      "Let's start by";
    assert.equal(looksLikeTutorialProse(t), true);
  });

  it('does not flag short real code', () => {
    const code = `import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class BookingApiClientService {}`;
    assert.equal(looksLikeTutorialProse(code), false);
  });

  it('still flags tool JSON blobs', () => {
    assert.equal(
      looksLikeToolCallJsonLeak('{"name":"write_file","arguments":{"path":"x.ts"}}'),
      true
    );
  });
});

describe('placeholder and JSON tail rejection', () => {
  const bad = `// This is a placeholder for the booking-api-client service
// You can implement your logic here."
  }
}
\`\``;

  it('detects placeholder stub', () => {
    assert.equal(looksLikePlaceholderStub(bad), true);
  });

  it('rejects placeholder in validateWriteContents', () => {
    const err = validateWriteContents(sanitizeFileContents(bad), 'shared/booking-api-client.service.ts');
    assert.ok(err);
  });

  it('strips trailing JSON garbage', () => {
    const cleaned = stripBrokenJsonTail(bad);
    assert.ok(!/\}\s*\}\s*`/.test(cleaned));
  });
});
