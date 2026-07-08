import { describe, expect, it } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';
import { deletePrompt, listPrompts, upsertPrompt } from '../prompts';

const RAW = {
  id: 'p1',
  name: 'Review',
  category: 'code',
  body: 'Review this diff.',
  created_at: 100,
  updated_at: 200,
};

describe('listPrompts', () => {
  it('normalizes snake_case timestamps from the backend', async () => {
    mockIPC((cmd) => (cmd === 'list_prompts' ? [RAW] : undefined));
    const prompts = await listPrompts();
    expect(prompts).toEqual([
      {
        id: 'p1',
        name: 'Review',
        category: 'code',
        body: 'Review this diff.',
        createdAt: 100,
        updatedAt: 200,
      },
    ]);
  });

  it('returns an empty list untouched', async () => {
    mockIPC((cmd) => (cmd === 'list_prompts' ? [] : undefined));
    await expect(listPrompts()).resolves.toEqual([]);
  });
});

describe('upsertPrompt', () => {
  it('defaults id and category to null for a new prompt', async () => {
    const payloads: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd !== 'upsert_prompt') return undefined;
      payloads.push(payload);
      return RAW;
    });
    const prompt = await upsertPrompt({ name: 'Review', body: 'Review this diff.' });
    expect(payloads).toEqual([
      { id: null, name: 'Review', body: 'Review this diff.', category: null },
    ]);
    expect(prompt.createdAt).toBe(100);
    expect(prompt.updatedAt).toBe(200);
  });

  it('passes through id and category on edit', async () => {
    const payloads: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd !== 'upsert_prompt') return undefined;
      payloads.push(payload);
      return { ...RAW, updated_at: 300 };
    });
    const prompt = await upsertPrompt({
      id: 'p1',
      name: 'Review',
      body: 'Review this diff.',
      category: 'code',
    });
    expect(payloads).toEqual([
      { id: 'p1', name: 'Review', body: 'Review this diff.', category: 'code' },
    ]);
    expect(prompt.updatedAt).toBe(300);
  });
});

describe('deletePrompt', () => {
  it('forwards the id and returns the backend verdict', async () => {
    const payloads: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd !== 'delete_prompt') return undefined;
      payloads.push(payload);
      return true;
    });
    await expect(deletePrompt('p1')).resolves.toBe(true);
    expect(payloads).toEqual([{ id: 'p1' }]);
  });

  it('returns false when the prompt was already gone', async () => {
    mockIPC((cmd) => (cmd === 'delete_prompt' ? false : undefined));
    await expect(deletePrompt('missing')).resolves.toBe(false);
  });
});
