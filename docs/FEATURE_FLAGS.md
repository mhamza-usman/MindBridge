# Feature flags

MindBridge has three UI/logic flags. Two ways to set them:

| Flag | Effect |
|---|---|
| `NEXT_PUBLIC_UI_V2` | Enables the assurance shell at `/live` |
| `NEXT_PUBLIC_ASSURANCE_LAYER` | Enables assurance logic |
| `NEXT_PUBLIC_FLEET_VIEW` | Enables the fleet dock item |
| `NEXT_PUBLIC_SYNTHETIC` | Enables scripted synthetic scenarios (demo only, labelled Synthetic) |

## Important: `NEXT_PUBLIC_*` is build-time

Next.js inlines `NEXT_PUBLIC_*` variables into the client bundle **at build
time**. Setting them on Cloud Run (runtime env) has no effect on already-built
client code — the values are baked into the JavaScript shipped to the browser.

Consequences:

- To change a flag for the deployed site, rebuild and redeploy with the env
  var set (e.g. `NEXT_PUBLIC_FLEET_VIEW=true gcloud run deploy ...`).
- For demos and per-session toggles, use the query-string overrides instead —
  they are read at runtime in the browser:
  - `?ui=v2` — assurance shell
  - `?fleet=1` — fleet view
  - `?synthetic=1` — synthetic scenarios

The query overrides work regardless of build-time flags, so the deployed site
at https://hexabotics.co.uk exposes both interfaces via the nav switcher
without needing rebuilds.
