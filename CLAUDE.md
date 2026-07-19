# Loometo — contributor & agent guide

Loometo is an open-source, node-based AI creative studio. Drag AI tools onto a
canvas, wire them together, hit Run. It's model-agnostic: one MuAPI key routes
to hundreds of image/video/3D/audio models, and you bring your own keys instead
of paying a per-credit platform.

This file orients both human contributors and AI coding agents (Claude Code,
Codex, Cursor) working in the repo.

## Stack

- Next.js 14 (App Router), React 18, TypeScript
- React Flow (`@xyflow/react`) — the canvas
- Zustand (+ persist) — state, with IndexedDB offload for heavy media blobs
- Tailwind CSS — styling (claymorphism design tokens in `globals.css`)
- No database, no auth — runs entirely locally, keys stay on your machine

## Architecture

```
app/
  api/proxy/*        server-side key-holding proxies (muapi, google, elevenlabs, r2, fetch)
  api/canvas/*       the agent bridge — external tools drive the canvas over HTTP
  demo/[slug]        public read-only showcase (loads /public/demos/<slug>.json)
components/
  FlowCanvas.tsx     the React Flow canvas + node registry
  nodes/AllNodes.tsx every node implementation (large; one file on purpose)
  nodes/BaseNode.tsx shared node shell (header, handles, run button, status)
  nodes/ModelParams  schema-driven provider pills + model picker + param fields
  ui/                ProviderPills, RoutePicker, Select, PromptLint, …
lib/
  api/dispatch.ts    routes a model+params to the right provider and runs it
  api/router.ts      per-model route table (direct provider vs MuAPI reseller)
  api/capabilities   loads public/muapi-schema.json (the model catalog)
  api/llm.ts         LLM + TTS provider logic
  flow/nodeIO.ts     handle → data-field mapping (how outputs feed inputs)
  flow/propagate.ts  one-hop data flow along edges
  flow/templates.ts  pre-wired pipeline templates
  store/             Zustand store + IndexedDB blob store
mcp/                 loometo-mcp: zero-dep MCP server so agents drive the canvas
```

## Key concepts

- **Model catalog** is `public/muapi-schema.json` — every model + its params.
  Selectors pull allowed values from here so we never offer a param a model
  rejects. Bump `SCHEMA_VERSION` in `lib/api/capabilities.ts` when you edit it.
- **Routing**: a model can run via a direct provider or the MuAPI reseller.
  `lib/api/router.ts` holds the per-model route table; `dispatch.ts` executes.
- **Data flow**: nodes are wired by handles. `nodeIO.ts` maps each handle to a
  data field; `propagate.ts` copies an output field into the connected input.
- **Proxies**: `/api/proxy/*` attach keys server-side. Key resolution:
  `.env.local` wins; if absent, the proxy falls back to the browser-pasted
  key (Settings → API Keys) arriving as an `x-user-key` header — see
  `lib/api/userKeys.ts`. Proxies are localhost-only by default (see below).
- **Agent bridge**: `/api/canvas/op` (mutations) + `/api/canvas/snapshot`
  (read) + `/api/canvas/events` (SSE live-sync). `mcp/` wraps these as MCP
  tools so any coding agent can build workflows in natural language.

## Conventions

- Every node has an `(i)` info button with a plain-English explanation.
- New nodes: implement in `AllNodes.tsx`, register in `FlowCanvas.tsx`
  `nodeTypes`, add handle→field mapping in `nodeIO.ts`.
- Heavy media (data: URLs) must not hit localStorage — it goes to IndexedDB
  via the blob store; add new heavy fields to `HEAVY_KEYS` in the store.
- User-facing copy avoids em/en dashes and other AI tells.

## Run

```bash
npm install
npm run dev                  # http://localhost:3005
# then paste your MuAPI key in the app: Setup Keys → Save
# (or: cp .env.example .env.local, add MUAPI_API_KEY, restart)
```

## Security note

The proxy and canvas-bridge routes are **localhost-only** by default. They have
no auth and are meant for local use. Do not expose the dev server to the public
internet as-is.
