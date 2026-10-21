# Lambda Lineage

A browser-based lineage explorer with historical family positions, fixed pledge-class
rows, pan/zoom, a minimap, exact roster search, and isolated ancestor/descendant views.
The framework has no runtime dependencies or external assets.

## Lineage source and local build

```sh
make setup
make serve
```

Open <http://127.0.0.1:8000>. `make setup` uses `uv` when installed and falls back
to `python3 -m venv`; the Python scripts use only the standard library. Run
`make help` to see all available commands.

The canonical, sanitized source is [`source/lineage.json`](source/lineage.json). It
contains stable opaque IDs, display names, pledge class, President/Sensei/Evan Chen Award
roles, layout positions, and relationship edges only. It intentionally excludes
roster numbers and all contact, location, career, and other directory fields. The
preparation script validates this file and writes the viewer's preloaded graph to
ignored `public/data/`; these generated files must not be committed.

## Contribute a lineage update

For a guided edit, open **Edit lineage** in the viewer. Add members with their class
and optional President/Sensei/Evan Chen Award roles; search for a Big and Little to add a relationship,
or remove a recorded relationship. The graph updates locally as you work. Use
**Download lineage.json for PR**, replace `source/lineage.json` with the downloaded
file, run the checks below, and open a pull request. Nothing is written to the hosted
site from the editor.

You can also edit `source/lineage.json` directly in a fork. Keep existing member IDs
unchanged; add new members with UUIDv4 IDs. The `classes` array defines the chronological
class order. Each member's `class` value must match one of those entries. An edge's `source` is the Big Bro and its `target` is the Little. Multiple
Big Bros are supported. Do not add fields to the schema or include roster numbers or
directory information.

Validate and lint changes before opening a pull request:

```sh
make setup # once per checkout
make test
make lint
make build
```

The validator rejects unknown fields, duplicate/invalid IDs, invalid roles, missing
edge endpoints, duplicate/self relationships, and edges within the same class or
backwards in class order. PR CI runs the same validation and tests. Once merged, the
sanitized source is what the hosted viewer deploys; no private reconciliation files
are needed by contributors.

## Data model

Source IDs are stable UUIDv4 values. Viewer IDs are temporary array positions and are
regenerated from the source graph during each local build. Viewer edges point from Big
Bro (`source`) to Little (`target`). Layout positions preserve the historical diagram
and newer family corridors; spacing is scaled to prevent card overlap. Isolated mode
keeps those same horizontal family corridors while hiding unrelated members, avoiding
the crossings caused by independently centering each row.
Long edges are routed to preserve the class-row layout and avoid unrelated cards.

Selecting a point traces its connected ancestors and descendants separately, without
including siblings and cousins.

The historical workbook/TikZ reconciliation inputs remain local-only and are not
required to edit or validate the public source graph.

## View locally

Optional static preview, bound to this computer only:

```sh
make serve
```

Then visit <http://127.0.0.1:8000>. Select a member to highlight their
connections; **Isolate lineage** reduces the map to those ancestors and descendants. Drag to pan,
scroll to move, use Ctrl/Command + scroll or the buttons to zoom. **Full overview**
fits the whole map; the percentage button returns to readable 100% size. The minimap
can be clicked to navigate. Nodes and relationship buttons support keyboard selection.

## Cloudflare Workers hosting

### Local preview and deploy

Build the same preloaded Worker package used by CI, then run it locally:

```sh
make preview
```

`make preview` starts Cloudflare's local Worker preview. To publish manually from
your computer, authenticate once with `cf auth login`, then run:

```sh
make deploy
```

This deploys the Worker configured in `cloudflare/cloudflare.config.ts`.

### Production deploys from GitHub

The `Lineage CI` workflow validates the canonical source, runs the tests and
builds the Worker package on pull requests. `Deploy lineage to Cloudflare` runs
only after a push to `main` (normally a merged pull request); it repeats those
checks, builds, and deploys the same package to the existing `workers.dev` Worker.
Do not also enable Cloudflare Workers Builds for this repository, or each merge
could deploy twice.

In GitHub, open **Settings → Secrets and variables → Actions** and add these
repository secrets:

- `CLOUDFLARE_API_TOKEN`: an API token scoped to this account with the **Workers
  Editor** permission for deploying Worker code. Store it as a GitHub secret;
  never put it in the source, workflow YAML, or a command line.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID that owns the Worker.

The deploy job uses those secrets only through environment variables. Pull
requests do not receive deployment credentials. The API token is not needed for
local preview; `cf auth login` is used for an intentional local deploy.

For a manual package build without starting the preview, run:

```sh
make build
```

This creates an isolated deploy folder with Cloudflare's Vite plugin and static assets.
The preloaded graph is generated from the tracked sanitized source. Do not deploy the
repository root or local reconciliation files. Deployment response headers prohibit
network connections from the application.

The Worker is served on its `workers.dev` hostname. Custom-domain setup is separate;
first confirm the chapter still controls its registrar account before changing DNS.

## Verification

`make test` runs viewer, editor, UI, and source-validation tests. `make lint` checks
Python and JavaScript syntax plus whitespace. CI runs both targets and builds the
Worker before any deployment.

