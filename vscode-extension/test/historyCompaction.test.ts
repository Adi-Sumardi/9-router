import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compactHistory, COMPACTION_MIN_TOTAL_CHARS } from '../src/historyCompaction';
import type { ChatMessage } from '../src/routerClient';

/** Riwayat jalur native tool-calling yang cukup besar untuk memicu compaction. */
function buildBigNativeHistory(): ChatMessage[] {
  const bigFile = 'x'.repeat(15000);
  return [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'tolong perbaiki bug di modul auth' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: `File: src/auth.ts\n${bigFile}` },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'grep_workspace', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_2', content: `120 matches\n${bigFile}` },
    { role: 'assistant', content: 'Saya lanjut periksa.' },
    { role: 'user', content: 'oke lanjut' },
    { role: 'assistant', content: 'siap' }
  ];
}

describe('compactHistory', () => {
  test('shrinks bulky tool results on the native tool-calling path', () => {
    const history = buildBigNativeHistory();
    const before = history[3].content!.length;
    compactHistory(history);
    assert.ok(history[3].content!.length < before, 'isi tool result seharusnya dipangkas');
    assert.match(history[3].content!, /dipangkas untuk menghemat context/);
  });

  test('NEVER removes a message — every tool_call keeps its paired tool result', () => {
    const history = buildBigNativeHistory();
    const toolCallIds = history
      .filter(m => m.role === 'assistant' && m.tool_calls)
      .flatMap(m => m.tool_calls!.map(tc => tc.id));

    compactHistory(history);

    for (const id of toolCallIds) {
      const paired = history.find(m => m.role === 'tool' && m.tool_call_id === id);
      assert.ok(paired, `tool result untuk ${id} hilang — ini akan membuat request berikutnya ditolak provider`);
    }
  });

  test('preserves message count and role order exactly', () => {
    const history = buildBigNativeHistory();
    const rolesBefore = history.map(m => m.role);
    compactHistory(history);
    assert.deepEqual(history.map(m => m.role), rolesBefore);
  });

  test('leaves the system prompt and the original user prompt untouched', () => {
    const history = buildBigNativeHistory();
    const system = history[0].content;
    const firstUser = history[1].content;
    compactHistory(history);
    assert.equal(history[0].content, system);
    assert.equal(history[1].content, firstUser);
  });

  test('keeps the most recent messages intact', () => {
    const history = buildBigNativeHistory();
    const lastThree = history.slice(-3).map(m => m.content);
    compactHistory(history);
    assert.deepEqual(history.slice(-3).map(m => m.content), lastThree);
  });

  test('does nothing when the history is still small', () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'halo' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'y'.repeat(2000) },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'lanjut' },
      { role: 'assistant', content: 'siap' }
    ];
    const total = history.reduce((a, m) => a + (m.content?.length || 0), 0);
    assert.ok(total < COMPACTION_MIN_TOTAL_CHARS, 'prasyarat test: riwayat harus di bawah ambang');
    const snapshot = history.map(m => m.content);
    compactHistory(history);
    assert.deepEqual(history.map(m => m.content), snapshot);
  });

  test('still compacts legacy text-tag results carried in user messages', () => {
    const bigOutput = 'z'.repeat(15000);
    const history: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'perbaiki build' },
      { role: 'user', content: `[Observed Command Output]\n$ npm run build\nStatus: Success (Exit 0)\nOutput:\n\`\`\`\n${bigOutput}\n\`\`\`\n`, internal: true },
      { role: 'assistant', content: 'lanjut' },
      { role: 'user', content: `[File Content: src/a.ts]\n\`\`\`\n${bigOutput}\n\`\`\`\n`, internal: true },
      { role: 'assistant', content: 'oke' },
      { role: 'user', content: 'terus' },
      { role: 'assistant', content: 'siap' }
    ];
    compactHistory(history);
    assert.match(history[2].content!, /Past Command: "npm run build" completed successfully/);
    assert.match(history[4].content!, /was previously inspected/);
  });
});
