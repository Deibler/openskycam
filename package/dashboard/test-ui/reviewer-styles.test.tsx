import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The reviewer's stylesheet once shared `.wk-editor` with the workflow editor and turned its page black.
it('gives the reviewer class names no other stylesheet defines', () => {
  const root = `${process.cwd()}/ui/`;
  const classes = (file: string) => new Set(readFileSync(root + file, 'utf8').match(/\.wk-[a-z0-9-]+(?![a-z0-9-])/g));
  const others = new Set(
    (readdirSync(root, { recursive: true }) as string[])
      .filter(file => file.endsWith('.css') && !file.endsWith('reviewer.css') && !file.includes('node_modules'))
      .flatMap(file => [...classes(file)]),
  );
  const shared = [...classes('features/workshop/styles/reviewer.css')].filter(name => others.has(name));
  expect(shared).toEqual([]);
});
