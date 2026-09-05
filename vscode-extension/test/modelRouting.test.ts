import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeModel, buildModelChain, buildLightChain } from '../src/modelRouting';

describe('categorizeModel', () => {
  test('detects free-tier models by name pattern', () => {
    assert.equal(categorizeModel('free-coding'), 'free');
    assert.equal(categorizeModel('groq/openai/gpt-oss-120b'), 'free');
    assert.equal(categorizeModel('google/gemma-2-9b'), 'free');
  });

  test('detects premium models by name pattern', () => {
    assert.equal(categorizeModel('claude-virtually-unlimited'), 'pro');
    assert.equal(categorizeModel('claude-sonnet-5-fusion'), 'pro');
    assert.equal(categorizeModel('deepseek-r1'), 'pro');
  });

  test('falls back to "other" for names matching no pattern', () => {
    assert.equal(categorizeModel('ag/mystery-model-x'), 'other');
  });
});

describe('buildModelChain', () => {
  const available = [
    'claude-sonnet-5-fusion',
    'claude-virtually-unlimited',
    'free-coding',
    'ag/mystery-model-x'
  ];

  test('always puts the primary model first', () => {
    const chain = buildModelChain('hybrid', 'claude-sonnet-5-fusion', available);
    assert.equal(chain[0], 'claude-sonnet-5-fusion');
  });

  test('pro pool never falls back to a free-tier model', () => {
    const chain = buildModelChain('pro', 'claude-virtually-unlimited', available);
    assert.ok(!chain.includes('free-coding'), 'free model must not appear in the pro chain');
  });

  test('free pool prefers other free models right after the primary', () => {
    const chain = buildModelChain('free', 'free-coding', available);
    assert.equal(chain[0], 'free-coding');
    // Tidak ada model 'free' lain di daftar, jadi kandidat berikutnya harus 'other'
    // (bukan langsung lompat ke pro).
    assert.equal(chain[1], 'ag/mystery-model-x');
  });

  test('hybrid pool cascades pro before free (subscription -> cheap -> free)', () => {
    const chain = buildModelChain('hybrid', 'claude-sonnet-5-fusion', available);
    const proIndex = chain.indexOf('claude-virtually-unlimited');
    const freeIndex = chain.indexOf('free-coding');
    assert.ok(proIndex < freeIndex, 'pro harus dicoba sebelum free di pool hybrid');
  });

  test('returns only the primary when no other models are available', () => {
    assert.deepEqual(buildModelChain('hybrid', 'solo-model', ['solo-model']), ['solo-model']);
    assert.deepEqual(buildModelChain('hybrid', 'solo-model', []), ['solo-model']);
  });

  test('never duplicates a model in the chain', () => {
    const chain = buildModelChain('hybrid', 'claude-sonnet-5-fusion', available);
    assert.equal(new Set(chain).size, chain.length);
  });
});

describe('buildLightChain', () => {
  test('prefers the cheapest model first for non-pro pools', () => {
    const chain = ['claude-sonnet-5-fusion', 'claude-virtually-unlimited', 'free-coding'];
    const light = buildLightChain('hybrid', chain);
    assert.equal(light[0], 'free-coding');
  });

  test('keeps the primary as the last-resort candidate', () => {
    const chain = ['claude-sonnet-5-fusion', 'free-coding'];
    const light = buildLightChain('hybrid', chain);
    assert.equal(light[light.length - 1], 'claude-sonnet-5-fusion');
  });

  test('pro pool is not downgraded to a free model even for light steps', () => {
    const chain = ['claude-virtually-unlimited', 'ag/mystery-model-x', 'free-coding'];
    const light = buildLightChain('pro', chain);
    assert.ok(!light.includes('free-coding'), 'pool pro tidak boleh turun ke model gratisan');
    assert.equal(light[0], 'ag/mystery-model-x');
  });

  test('returns the chain unchanged when there is only one model', () => {
    assert.deepEqual(buildLightChain('hybrid', ['solo-model']), ['solo-model']);
  });

  test('never duplicates a model in the light chain', () => {
    const chain = ['claude-sonnet-5-fusion', 'free-coding', 'ag/mystery-model-x'];
    const light = buildLightChain('hybrid', chain);
    assert.equal(new Set(light).size, light.length);
  });
});
