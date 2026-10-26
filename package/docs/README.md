# Documentation site

The public documentation, built with [Astro](https://astro.build) into static files. A Worker serves them with no code of its own. [Pagefind](https://pagefind.app) builds the search index at build time.

```sh
npm ci
npm run dev        # http://localhost:4321, reloads on save
npm run build      # dist/, the search index, then a check that every internal link and #anchor resolves
npm run deploy     # build, then deploy to DOCS_HOST (from the environment or the repository's .env)
```

Pages are the Markdown files in the repository's [`docs/`](../../docs) folder, so they read the same on GitHub; the path is the URL (`capture/store.md` is `/capture/store/`, `README.md` is the home page). Link between pages with relative `.md` paths (`../capture/store.md#retention`): the build turns them into site URLs. Every page needs `title` and `description` front matter, plus an optional shorter `sidebar` label, and must be listed in `src/nav.ts` with a [Lucide](https://lucide.dev/icons) icon. The description is shown under the title, so the first paragraph should not repeat it. The build fails on a page missing from the sidebar, a sidebar entry without a page, an unknown icon, or a broken link.

Images go in `docs/images/` and are linked relatively too; the repository README uses them. A `> ` blockquote renders as a note. Astro caches rendered Markdown across builds: after changing `astro.config.mjs`, delete `node_modules/.astro` or the old output stays.

## Writing a page

These pages are read by people setting up and changing openskycam. Write for someone at a terminal with the repository open.

- **Start with what the thing is and does**, in one or two sentences. No "In this guide", no "Welcome".
- **Be exact.** Use real commands, paths, flags, limits, defaults and error behaviour, checked against the code. If you cannot find a number in the code or a measurement, leave it out.
- **Say how it fails.** What happens when a host is offline, a disk fills, a key expires or a job's lease is lost.
- **Prefer tables** for options, settings and endpoints; use code blocks for anything a reader types.
- **Link instead of repeating.** Link to the page that owns a topic (`../capture/store.md#retention`). Link to source files on GitHub when a reader will want the details.
- **Plain words.** No "powerful", "seamless", "robust", "leverage", "simply", "just", emoji or exclamation marks. No summary paragraph at the end.
- Use second person and the imperative for steps ("Run", "Set"), and the present tense for behaviour ("The relay retries").
- Times are UTC. Hosts are placeholders: `<site-host>`, `<api-host>`, `<store-host>`, `<relay-host>`.
