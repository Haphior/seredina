import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('/health', () => {
  const app = buildApp();
  afterAll(() => app.close());

  it("reports the release from the root package.json, so an update can be checked", async () => {
    const root = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as { version: string };
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: root.version });
  });
});
