import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { satteri } from '@astrojs/markdown-satteri';
import { defineConfig } from 'astro/config';
import icons from 'lucide-static/icon-nodes.json' with { type: 'json' };

const languages = { sh: 'Shell', json: 'JSON', python: 'Python', http: 'HTTP', text: 'Text' };
const element = (tagName, properties, children) => ({ type: 'element', tagName, properties, children });
const svg = name =>
  element(
    'svg',
    { className: [`lucide-${name}`], viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ariaHidden: 'true' },
    icons[name].map(([tag, attributes]) => element(tag, attributes, [])),
  );

/** Frames each code block with its language and a copy button; Docs.astro wires up the button. */
const codeFrame = {
  name: 'code-frame',
  root(root) {
    const { lang } = this.options;
    const caption = element('figcaption', {}, [
      element('span', {}, [{ type: 'text', value: languages[lang] ?? '' }]),
      element('button', { type: 'button', ariaLabel: 'Copy code', dataCopyCode: '' }, [svg('copy'), svg('check')]),
    ]);
    return { type: 'root', children: [element('figure', { className: ['code'], dataLanguage: lang }, [caption, ...root.children])] };
  },
};

const docs = fileURLToPath(new URL('../../docs/', import.meta.url));

/** The site URL for a link from a page to another page as a relative .md file, or undefined for any other link. */
const siteUrl = (fileURL, href) => {
  const [target, anchor] = href.split('#');
  if (!target.endsWith('.md') || /^([a-z]+:|\/)/.test(target)) return undefined;
  const id = path.relative(docs, path.resolve(path.dirname(fileURLToPath(fileURL)), target)).replace(/\.md$/, '').replace(/^README$/, '');
  return (id ? `/${id}/` : '/') + (anchor ? `#${anchor}` : '');
};

/** Pages link to each other as relative .md files, which work on GitHub; the site serves them as /page/ URLs. */
const siteLinks = ({ fileURL }) => ({
  name: 'site-links',
  element: {
    filter: ['a'],
    visit(node, ctx) {
      const url = typeof node.properties.href === 'string' && siteUrl(fileURL, node.properties.href);
      if (url) ctx.setProperty(node, 'href', url);
    },
  },
});

export default defineConfig({
  trailingSlash: 'always',
  build: { format: 'directory' },
  markdown: {
    processor: satteri({ hastPlugins: [siteLinks] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, transformers: [codeFrame] },
  },
});
