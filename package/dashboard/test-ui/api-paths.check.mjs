import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// A value placed in an API path unencoded can carry `../` or `/`, and the browser resolves those before the
// request leaves: a run ID taken from the page URL could then reach a different same-origin endpoint.
const files = fs
  .readdirSync('ui', { recursive: true })
  .filter(file => /\.tsx?$/.test(file))
  .map(file => path.join('ui', file));
const constantChoice = /^[\w.]+ === '[^']*' \? '[^']*' : '[^']*'$/;

/** The `${…}` expressions in the path part (before any `?` outside an expression) of a template literal. */
function pathExpressions(literal) {
  const expressions = [...literal.matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
  let masked = literal;
  for (const m of expressions) masked = masked.slice(0, m.index) + 'x'.repeat(m[0].length) + masked.slice(m.index + m[0].length);
  const query = masked.indexOf('?');
  return expressions.filter(m => query === -1 || m.index < query).map(m => m[1].trim());
}

test('every value in a website API path is encoded', () => {
  const unencoded = [];
  for (const file of files) {
    for (const [literal] of fs.readFileSync(file, 'utf8').matchAll(/`\/api\/[^`]*`/g))
      for (const expression of pathExpressions(literal))
        if (!expression.startsWith('encodeURIComponent(') && !constantChoice.test(expression))
          unencoded.push(`${file}: \${${expression}}`);
  }
  assert.deepEqual(unencoded, []);
});

test('the check reads path and query parts correctly', () => {
  assert.deepEqual(pathExpressions('`/api/runs/${encodeURIComponent(id)}/review?cursor=${cursor}`'), ['encodeURIComponent(id)']);
  assert.deepEqual(pathExpressions("`/api/keys/${id}${type === 'rotate' ? '/rotate' : ''}`"), ['id', "type === 'rotate' ? '/rotate' : ''"]);
  assert.ok(constantChoice.test("kind === 'workflow' ? 'workflows' : 'buckets'"));
});
