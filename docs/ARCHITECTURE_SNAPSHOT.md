# MindBridge Architecture Snapshot

## Framework and Versions
- **Frontend**: Next.js 16.1.6 (App Router), React 19.2.4
- **Styling**: TailwindCSS v4
- **UI Protocol**: CopilotKit AG-UI (`@copilotkit/react-core` v1.57.4, `@copilotkit/a2ui-renderer` v1.57.4)
- **Backend / Agent**: Python (managed by `uv`), FastAPI, LangGraph (in `/agent`)

## Folder Map
- `/src/app`: Next.js routes (frontend).
- `/src/components`: React components.
- `/agent`: Python backend containing the FastAPI server and agent logic (`agent/src/`).
- `/docs`: Project documentation and reference HTML/markdown.
- `/scripts`: Utility scripts for running and setting up the agent and app.

## Routes and Pages
- `/live` (in `src/app/(pdf)/live/page.tsx`): The main live robot operations feed. Polls `/api/robot/frame` for continuous telemetry and renders the dashboard deterministically via `/api/robot/render` using AG-UI.
- `/fixed`, `/dynamic`, `/legal`: Documented in the environment variables as other agent endpoints.

## AG-UI Agent and Tool Wiring
The `/live` route operates without an LLM in the hot path. It uses `A2UIProvider` and `A2UIRenderer` to mount a surface. It continuously fetches telemetry from `/api/robot/frame`, passes it to `/api/robot/render` via POST, and receives `a2ui_operations` (e.g. `createSurface`, `updateDataModel`). These operations are fed directly into `actions.processMessages()` to drive the UI.

## NeSyConf Metrics
- **Where computed/stored**: Values (perception_confidence, plan_certainty, task_success_rate, system_uncertainty) are provided by the backend endpoint `/api/robot/frame`. They are received on the frontend and held in React component state (`useState`) within the `LivePage`.

## The Five Modes
- **Where decided**: The five modes (`autonomous`, `monitoring`, `advisory`, `intervention`, `emergency`) are returned by the backend (`/api/robot/render` returns `{ state: string }`). The frontend maps these string states to visual representations (labels, colors) via the `STATE_META` dictionary in `/live/page.tsx`.

## State Management
- **Frontend**: Standard React hooks (`useState`, `useEffect`, `useRef`) for telemetry polling and UI state.
- **Agent/UI State**: Managed by `@copilotkit/a2ui-renderer` using the `actions.processMessages` method to apply updates to the data model.

## Styling Approach
TailwindCSS utility classes are the primary styling mechanism (e.g. `flex`, `h-screen`, `bg-[var(--bg)]`). Some custom CSS variables are used for theme colors (`--ink`, `--mint`, `--bg`).

## Env Vars (Names Only)
- `AGENT_URL`
- `FIXED_AGENT_URL`
- `DYNAMIC_AGENT_URL`
- `LEGAL_AGENT_URL`
- `GEMINI_API_KEY`
- `MODEL`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `OFFLINE`
- `A2A_AGENT_URL`
- `A2A_INSTRUCTIONS`
- `NEXT_PUBLIC_ROBOT_API`

## Build and Deploy Setup
- **Local Dev**: `pnpm dev` uses `concurrently` to run both the Next.js frontend (`pnpm dev:ui`) and the Python agent (`pnpm dev:agent`).
- **Build**: `pnpm build` creates the production Next.js build.
- **Deploy**: A `Dockerfile` exists for containerized deployment to Google Cloud Run.
