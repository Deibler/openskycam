# Security

Report a vulnerability privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for it. Include what an attacker can reach (website, API key scope, relay, footage store, processor) and the steps to reproduce.

The website trusts only verified Cloudflare Access tokens, and the API trusts only scoped keys. The footage store accepts only the Workers' bearer token, and the processor only makes outgoing requests with its own key. A way around any of these is in scope, as is reading footage or data of a camera a key was not given.

Never include real API keys, Access tokens, camera passwords or footage in a report.

## Supported versions

Fixes go into `main` and the next release. To get them, run `git pull` in your clone and redeploy the parts that changed: `npm run setup -- website`, `ingest`, `store` or `relay` reruns that step even when its check passes, and a processor needs [a new runtime](https://docs.openskycam.org/processor/#runtimes).
