import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

export const collections = {
  docs: defineCollection({
    // The pages are the repository's docs/ folder, so they read the same on GitHub. docs/README.md is the home page.
    loader: glob({
      pattern: '**/*.md',
      base: '../../docs',
      generateId: ({ entry }) => entry.replace(/\.md$/, '').replace(/^README$/, 'index'),
    }),
    schema: z.object({ title: z.string(), description: z.string(), sidebar: z.string().optional() }),
  }),
};
