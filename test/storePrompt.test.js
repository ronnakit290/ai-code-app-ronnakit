import assert from 'assert';
import { parsePlaceholders, fillPlaceholders } from '../command/promptUtils.js';

suite('Prompt template helpers', () => {
  test('parsePlaceholders finds unique keys', () => {
    const keys = parsePlaceholders('Hello {{name}}, file: {{file}} and {{name}} again.');
    assert.deepStrictEqual(keys.sort(), ['file','name']);
  });

  test('fillPlaceholders replaces keys', () => {
    const out = fillPlaceholders('Build {{project}} with {{tool}}', { project: 'demo', tool: 'vite' });
    assert.strictEqual(out, 'Build demo with vite');
  });
});
