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

## Models and billing

Create a [Shared Endpoint](https://modal.com/docs/guide/shared-endpoints) first.
Use `/model` to select one of the text/tool-capable endpoints accessible to your
token. Model IDs are endpoint hostnames, not Hugging Face repository IDs.
Context limits, image input, and thinking levels come from Modal's `/v1/models`
metadata. Unsupported thinking levels are not offered.

Discovery runs on startup and after `/login modal`. Use `/reload` to refresh
after creating or deleting endpoints. Discovery has a 15-second timeout.
Catalogs stay in memory, scoped to the current credential; they are not restored
from disk. Offline startup therefore has no discovered Modal models. A failed
refresh retains models only for the same credential during that process.

Cost estimates use [Modal's published Shared Endpoint rates](https://modal.com/docs/guide/supported-models),
keyed by the underlying model. Pi requires numeric cost fields: for an unrecognized
model it shows zero estimates, and the model name explicitly says
`[cost unavailable]`. This does **not** mean inference is free. Estimates can lag
price changes; Modal billing is authoritative. Dedicated/custom endpoint URLs
and compute-based billing are outside this extension's scope.

## Upstream listing

Publishing the extension does not add it to Pi's provider documentation.
The placement and acceptance requirements for an external-provider listing
still need confirmation from Pi's maintainers. Pi requires explicit maintainer
`lgtm` approval before an upstream PR; see
[CONTRIBUTING.md](https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md).
