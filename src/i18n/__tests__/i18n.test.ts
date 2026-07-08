import { describe, expect, it } from 'vitest';
import { en, format, t, type MessageKey } from '../index';

describe('t()', () => {
  it('returns the en template for a known key', () => {
    expect(t('composer.send')).toBe('Send');
  });

  it('interpolates {name} placeholders', () => {
    expect(t('settings.modelHint', { model: 'grok-build' })).toBe('Active engine: grok-build');
    expect(t('statusBar.queued', { count: 3 })).toBe('+3 queued');
  });

  it('leaves unresolved placeholders intact when a param is missing', () => {
    expect(format('Hello {name}, {missing}!', { name: 'Ada' })).toBe('Hello Ada, {missing}!');
  });

  it('falls back to the key itself for a runtime-missing key', () => {
    expect(t('nope.not.a.key' as MessageKey)).toBe('nope.not.a.key');
  });

  it('stringifies numeric params', () => {
    expect(format('{n} items', { n: 0 })).toBe('0 items');
  });
});

describe('en catalog', () => {
  it('has no empty values', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en['${key}'] is empty`).not.toBe('');
    }
  });

  it('has no unused keys (every key is referenced somewhere in src/)', () => {
    // Raw-load all non-test sources under src/, excluding the catalog itself,
    // and check each key appears as a quoted literal somewhere.
    const modules = import.meta.glob('../../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const blob = Object.entries(modules)
      .filter(([path]) => !path.includes('__tests__') && !path.endsWith('i18n/en.ts'))
      .map(([, source]) => source)
      .join('\n');
    const unused = (Object.keys(en) as MessageKey[]).filter(
      (key) => !blob.includes(`'${key}'`) && !blob.includes(`"${key}"`),
    );
    expect(unused, `unused i18n keys: ${unused.join(', ')}`).toEqual([]);
  });
});
