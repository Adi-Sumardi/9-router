import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AgentEngine } from '../src/agentEngine';

describe('AgentEngine.parseTerminalCommands', () => {
  test('extracts official <sendago_cmd> tag with description', () => {
    const text = 'Menjalankan test:\n<sendago_cmd desc="Run tests">npm test</sendago_cmd>\nSelesai.';
    const result = AgentEngine.parseTerminalCommands(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].command, 'npm test');
    assert.equal(result[0].description, 'Run tests');
  });

  test('deduplicates identical commands', () => {
    const text = '<sendago_cmd>npm install</sendago_cmd><sendago_cmd>npm install</sendago_cmd>';
    const result = AgentEngine.parseTerminalCommands(text);
    assert.equal(result.length, 1);
  });

  test('falls back to actionable bash code block when no tag present', () => {
    const text = '```bash\nnpm install\nnpm run build\n```';
    const result = AgentEngine.parseTerminalCommands(text);
    assert.equal(result.length, 1);
    assert.match(result[0].command, /npm install/);
  });

  test('ignores non-actionable bash blocks in fallback (no known package manager/tool)', () => {
    const text = '```bash\necho "hello world"\n```';
    const result = AgentEngine.parseTerminalCommands(text);
    assert.equal(result.length, 0);
  });

  test('returns empty array when no commands present', () => {
    assert.deepEqual(AgentEngine.parseTerminalCommands('just a plain answer'), []);
  });
});

describe('AgentEngine.parseFileEdits', () => {
  test('extracts official <sendago_edit> tag', () => {
    const text = '<sendago_edit file="src/foo.ts" desc="Add helper">export const x = 1;</sendago_edit>';
    const result = AgentEngine.parseFileEdits(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].filePath, 'src/foo.ts');
    assert.equal(result[0].newContent, 'export const x = 1;');
    assert.equal(result[0].description, 'Add helper');
  });

  test('trims leading/trailing blank lines from content', () => {
    const text = '<sendago_edit file="a.ts">\n\nconst a = 1;\n\n</sendago_edit>';
    const result = AgentEngine.parseFileEdits(text);
    assert.equal(result[0].newContent, 'const a = 1;');
  });

  test('does not misfire on a plain markdown code example when tag is present elsewhere', () => {
    // Regression guard: fallback heuristics must NOT run once a real tag already matched.
    const text = '<sendago_edit file="a.ts">content</sendago_edit>\n### readme.md\n```md\nignored\n```';
    const result = AgentEngine.parseFileEdits(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].filePath, 'a.ts');
  });
});

describe('AgentEngine.parseFileReplaces', () => {
  test('extracts SEARCH/REPLACE diff format inside <sendago_replace>', () => {
    const text = [
      '<sendago_replace file="src/a.ts" desc="fix bug">',
      '<<<<<<< SEARCH',
      'const x = 1;',
      '=======',
      'const x = 2;',
      '>>>>>>> REPLACE',
      '</sendago_replace>'
    ].join('\n');
    const result = AgentEngine.parseFileReplaces(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].filePath, 'src/a.ts');
    assert.equal(result[0].searchContent, 'const x = 1;');
    assert.equal(result[0].replaceContent, 'const x = 2;');
  });

  test('extracts <search>/<replace> XML format inside <sendago_replace>', () => {
    const text = '<sendago_replace file="b.ts"><search>old</search><replace>new</replace></sendago_replace>';
    const result = AgentEngine.parseFileReplaces(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].searchContent, 'old');
    assert.equal(result[0].replaceContent, 'new');
  });
});

describe('AgentEngine.parseGrepActions', () => {
  test('extracts query and optional attributes', () => {
    const text = '<sendago_grep query="TODO" include="*.ts" path="src" regex="true" />';
    const result = AgentEngine.parseGrepActions(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].query, 'TODO');
    assert.equal(result[0].include, '*.ts');
    assert.equal(result[0].path, 'src');
    assert.equal(result[0].isRegex, true);
  });

  test('ignores tag without a query', () => {
    const text = '<sendago_grep include="*.ts" />';
    assert.deepEqual(AgentEngine.parseGrepActions(text), []);
  });
});

describe('AgentEngine.parseFindFilesActions', () => {
  test('extracts pattern and maxResults', () => {
    const text = '<sendago_find pattern="*Controller.php" max="10" />';
    const result = AgentEngine.parseFindFilesActions(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].pattern, '*Controller.php');
    assert.equal(result[0].maxResults, 10);
  });
});

describe('AgentEngine.parseReadFileActions', () => {
  test('extracts file with line range', () => {
    const text = '<sendago_read file="src/big.ts" start="10" end="50"/>';
    const result = AgentEngine.parseReadFileActions(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].filePath, 'src/big.ts');
    assert.equal(result[0].startLine, 10);
    assert.equal(result[0].endLine, 50);
  });

  test('deduplicates identical file+range requests', () => {
    const text = '<sendago_read file="a.ts" start="1" end="5"/><sendago_read file="a.ts" start="1" end="5"/>';
    assert.equal(AgentEngine.parseReadFileActions(text).length, 1);
  });
});

describe('AgentEngine.parseTaskDone', () => {
  test('extracts summary attribute', () => {
    const text = '<sendago_done summary="All tests pass">Verified via npm test.</sendago_done>';
    const result = AgentEngine.parseTaskDone(text);
    assert.equal(result?.summary, 'All tests pass');
  });

  test('returns null when no done tag present', () => {
    assert.equal(AgentEngine.parseTaskDone('still working...'), null);
  });
});

describe('AgentEngine.parseImageActions', () => {
  test('extracts file, prompt, and dimensions in any attribute order', () => {
    const text = '<sendago_image prompt="a red fox" width="512" file="assets/fox.png" height="512" desc="fox image"></sendago_image>';
    const result = AgentEngine.parseImageActions(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].filePath, 'assets/fox.png');
    assert.equal(result[0].prompt, 'a red fox');
    assert.equal(result[0].width, 512);
    assert.equal(result[0].height, 512);
  });
});

describe('AgentEngine.parsePlanSteps', () => {
  test('extracts ordered steps with optional command', () => {
    const text = [
      '<sendago_plan>',
      '  <step id="1" title="Install deps" command="npm install">Install project dependencies</step>',
      '  <step id="2" title="Run build">Build the project</step>',
      '</sendago_plan>'
    ].join('\n');
    const result = AgentEngine.parsePlanSteps(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Install deps');
    assert.equal(result[0].command, 'npm install');
    assert.equal(result[1].command, undefined);
  });

  test('returns empty array when no plan block present', () => {
    assert.deepEqual(AgentEngine.parsePlanSteps('no plan here'), []);
  });
});

describe('AgentEngine.buildActionsFromToolCalls (native tool-calling)', () => {
  test('converts a run_command tool_call into a CommandAction tagged with toolCallId', () => {
    const result = AgentEngine.buildActionsFromToolCalls([
      { id: 'call_1', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'npm test' }) } }
    ]);
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0].command, 'npm test');
    assert.equal(result.commands[0].toolCallId, 'call_1');
  });

  test('converts replace_in_file, grep_workspace, and task_done together', () => {
    const result = AgentEngine.buildActionsFromToolCalls([
      { id: 'c1', type: 'function', function: { name: 'replace_in_file', arguments: JSON.stringify({ file: 'a.ts', search: 'old', replace: 'new' }) } },
      { id: 'c2', type: 'function', function: { name: 'grep_workspace', arguments: JSON.stringify({ query: 'TODO' }) } },
      { id: 'c3', type: 'function', function: { name: 'task_done', arguments: JSON.stringify({ summary: 'done' }) } }
    ]);
    assert.equal(result.replaces.length, 1);
    assert.equal(result.replaces[0].toolCallId, 'c1');
    assert.equal(result.greps.length, 1);
    assert.equal(result.greps[0].toolCallId, 'c2');
    assert.equal(result.done?.summary, 'done');
    assert.equal(result.done?.toolCallId, 'c3');
  });

  test('silently skips a tool_call with malformed JSON arguments instead of throwing', () => {
    const result = AgentEngine.buildActionsFromToolCalls([
      { id: 'bad', type: 'function', function: { name: 'run_command', arguments: '{not valid json' } }
    ]);
    assert.equal(result.commands.length, 0);
  });

  test('ignores edit_file call missing required "content" field', () => {
    const result = AgentEngine.buildActionsFromToolCalls([
      { id: 'c1', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ file: 'a.ts' }) } }
    ]);
    assert.equal(result.edits.length, 0);
  });

  test('converts create_plan into PlanStep array', () => {
    const result = AgentEngine.buildActionsFromToolCalls([
      { id: 'p1', type: 'function', function: { name: 'create_plan', arguments: JSON.stringify({ steps: [{ title: 'Step A' }, { title: 'Step B', command: 'npm run x' }] }) } }
    ]);
    assert.equal(result.planSteps.length, 2);
    assert.equal(result.planSteps[0].title, 'Step A');
    assert.equal(result.planSteps[1].command, 'npm run x');
  });
});
