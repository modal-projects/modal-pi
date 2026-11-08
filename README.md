# Modal for Pi

Provider extension for [Pi](https://pi.dev) using
[Modal Shared Endpoints](https://modal.com/docs/guide/shared-endpoints).

## Development

Requires Node.js 22.19 or later. Tested against Pi 1.5.0.

```sh
npm install --ignore-scripts
npm run check
```

Build before loading the local package:

```sh
npm run build
pi install ./
```

Authenticate with `/login modal`, or set `MODAL_PROXY_TOKEN` to a combined
`wk-<id>.ws-<secret>` [proxy token](https://modal.com/docs/guide/endpoints#proxy-tokens).
Modal CLI API tokens are not inference credentials.

## Upstream listing

Publishing the extension does not add it to Pi's provider documentation.
The placement and acceptance requirements for an external-provider listing
still need confirmation from Pi's maintainers. Pi requires explicit maintainer
`lgtm` approval before an upstream PR; see
[CONTRIBUTING.md](https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md).
