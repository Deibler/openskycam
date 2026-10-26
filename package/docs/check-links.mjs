/** Fails the build when a page links to a page or #anchor that the built site does not have. */
import fs from 'node:fs';
import path from 'node:path';

const site = 'dist';
const pages = fs
  .readdirSync(site, { recursive: true })
  .filter(file => file.endsWith('.html'))
  .map(file => path.join(site, file));
const ids = new Map(
  pages.map(file => [file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/ id="([^"]+)"/g)].map(m => m[1]))]),
);
const broken = [];
for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const [, link] of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
    if (/^(https?:|mailto:)/.test(link)) continue;
    const [target, anchor] = link.split('#');
    const resolved = target
      ? path.join(site, target.startsWith('/') ? target : path.relative(site, path.join(path.dirname(file), target)))
      : file;
    const page =
      fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? path.join(resolved, 'index.html') : resolved;
    if (!fs.existsSync(page)) broken.push(`${file}: ${link} (no page)`);
    else if (anchor && !ids.get(page)?.has(decodeURIComponent(anchor))) broken.push(`${file}: ${link} (no #${anchor})`);
  }
}
if (broken.length) {
  console.error(`Broken links:\n${broken.join('\n')}`);
  process.exit(1);
}
console.log(`Links: ${pages.length} pages checked.`);
