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
from disk. Pi's `--offline` / `PI_OFFLINE=1` skips discovery and therefore starts
without Modal models. A failed refresh retains models only for the same credential
during that process.

Cost estimates use [Modal's published Shared Endpoint rates](https://modal.com/docs/guide/supported-models),
keyed by the underlying model. Pi requires numeric cost fields: for an unrecognized
model it shows zero estimates, and the model name explicitly says
`[cost unavailable]`. This does **not** mean inference is free. Estimates can lag
price changes; Modal billing is authoritative. Dedicated/custom endpoint URLs
and compute-based billing are outside this extension's scope.

Requests use Pi's OpenAI Chat Completions implementation. Pi's session ID becomes
the `Modal-Routing-Affinity-Key` header, keeping a conversation routed consistently.
Explicit caller overrides (including a null header to suppress affinity) are preserved.

## Testing

`npm run check` runs lint, type-checking, and offline auth/discovery/protocol tests.
`npm run test:package` builds a tarball, installs it with Pi in a clean directory,
and verifies package registration and the compiled extension's imports.
Both commands run in CI on Node 22 and 24. `npm pack` builds the extension automatically.

For billable integration tests against an existing endpoint:

```sh
export MODAL_PROXY_TOKEN="wk-<id>.ws-<secret>"
npm run test:live
```

Optionally set `MODAL_MODEL` to its endpoint hostname. The tests need a model with
tools, image input, and reasoning that can be disabled. They exercise stored-key
login, multi-turn tools, reasoning replay, usage/cost, vision, and cancellation.
They do not create endpoints, alter files, or publish packages.

To exercise Pi's coding loop against a disposable repository with failing tests:

```sh
pi --provider modal --model "<endpoint-hostname>" --thinking off --no-session -p \
  "Inspect this repository, fix the failing test without changing tests, then run the test suite."
```

Pi runs file and shell tools with your permissions. Review the repository before
running this command; inference is billable and the agent can edit files.

## Upstream listing

Publishing the extension does not add it to Pi's provider documentation.
The placement and acceptance requirements for an external-provider listing
still need confirmation from Pi's maintainers. Pi requires explicit maintainer
`lgtm` approval before an upstream PR; see
[CONTRIBUTING.md](https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md).
There is precedent for the package route: a maintainer asked the
[Nebius provider contributor](https://github.com/earendil-works/pi/issues/1768#issuecomment-3990986111)
to publish a Pi package via Git or npm.
