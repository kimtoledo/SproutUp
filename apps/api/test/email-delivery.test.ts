import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createInMemoryEmailDelivery,
  createUnconfiguredEmailDelivery,
  selectEmailDelivery,
} from '../src/notifications/email-delivery.js';
import { createLocalFileEmailDelivery } from '../src/notifications/local-file-email-delivery.js';

describe('in-memory email delivery', () => {
  it('captures every sent message in order', async () => {
    const delivery = createInMemoryEmailDelivery();
    await delivery.send({ to: 'a@sproutup.ph', subject: 'first', text: 'one' });
    await delivery.send({ to: 'b@sproutup.ph', subject: 'second', text: 'two' });
    expect(delivery.sent).toEqual([
      { to: 'a@sproutup.ph', subject: 'first', text: 'one' },
      { to: 'b@sproutup.ph', subject: 'second', text: 'two' },
    ]);
  });
});

describe('unconfigured email delivery', () => {
  it('fails closed instead of silently dropping the message', async () => {
    const delivery = createUnconfiguredEmailDelivery();
    await expect(
      delivery.send({ to: 'a@sproutup.ph', subject: 'x', text: 'y' }),
    ).rejects.toThrow('Email delivery is not configured');
  });
});

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('local file email delivery', () => {
  it('writes each message to its own file under the root, without overwriting', async () => {
    const dir = await tempDir('sproutup-email-');
    const delivery = createLocalFileEmailDelivery(dir);

    await delivery.send({
      to: 'reset-me@sproutup.ph',
      subject: 'Reset your password',
      text: 'https://api.example/reset-password/abc123',
    });
    await delivery.send({
      to: 'verify-me@sproutup.ph',
      subject: 'Verify your email',
      text: 'https://api.example/verify-email?token=def456',
    });

    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    const contents = await Promise.all(files.map((file) => readFile(join(dir, file), 'utf8')));
    expect(contents.some((body) => body.includes('reset-me@sproutup.ph') && body.includes('abc123'))).toBe(true);
    expect(contents.some((body) => body.includes('verify-me@sproutup.ph') && body.includes('def456'))).toBe(true);
  });
});

describe('selectEmailDelivery', () => {
  it('fails closed in production', async () => {
    const delivery = selectEmailDelivery({ environment: 'production', emailOutboxDir: '.data/unused' });
    await expect(delivery.send({ to: 'x@sproutup.ph', subject: 'x', text: 'y' })).rejects.toThrow(
      'Email delivery is not configured',
    );
  });

  it('resolves to the local file outbox outside production', async () => {
    const dir = await tempDir('sproutup-email-select-');
    const delivery = selectEmailDelivery({ environment: 'development', emailOutboxDir: dir });
    await delivery.send({ to: 'dev@sproutup.ph', subject: 'x', text: 'y' });
    expect(await readdir(dir)).toHaveLength(1);
  });
});
