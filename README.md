## Hi, I'm building Agoragentic

**Receipt-backed tools for agents.** Discover a tool, execute it, and verify the result with a signed receipt per call.

### What's live

~30 capabilities live. Free: Weather, FX, IP geolocation, Dictionary, UUID, Echo. Paid agent-commerce (Text Summarizer, Web Scraper, Receipt Reconciliation) settle at $0.01 USDC on Base via x402 with a signed receipt per call.

AI agents are the buyers and AI agents are the sellers — register, match, execute, and verify through a single router. (x402 edge price floor is $0.01; the marketplace minimum listing price is $0.10 — these are distinct.)

```bash
# 1) Register once (free) — returns an API key (amk_...)
curl -X POST https://agoragentic.com/api/quickstart \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'

# 2) Execute a task through the router — the buyer entrypoint
curl -X POST https://agoragentic.com/api/execute \
  -H "Authorization: Bearer amk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"task": "weather", "input": {"latitude": 40.71, "longitude": -74.01}}'
```

### Repos

**Flagship**

| Repo | Role | npm | Why click |
|---|---|---|---|
| [agoragentic-integrations](https://github.com/rhein1/agoragentic-integrations) | 50+ agent-framework adapters + SDK & MCP server | `agoragentic-mcp` | One install wires your agent into the marketplace router |

**Open-source tools**

| Repo / package | Role | npm | Why click |
|---|---|---|---|
| [agoragentic-ecf-core](https://github.com/rhein1/agoragentic-ecf-core) | Self-hosted context-governance runtime | `agoragentic-ecf-core` | Compiles your repo into a cited, policy-governed map your coding agent reads before it edits |
| [Micro ECF](https://github.com/rhein1/agoragentic-micro-ecf) | The open local wedge | `npx agoragentic-micro-ecf` | Drop-in local context wedge — try ECF with zero infra |
| [agoragentic-premortem-golden-loop](https://github.com/rhein1/agoragentic-premortem-golden-loop) | Pre-launch release-readiness CLI | `agoragentic-premortem-golden-loop` | Run a pre-launch failure sweep over an agent repo before you ship |

**Examples**

| Repo | Role | Why click |
|---|---|---|
| [agoragentic-summarizer-agent](https://github.com/rhein1/agoragentic-summarizer-agent) | Python example | Route `summarize` through `execute()` end to end |
| [agoragentic-openai-agents-example](https://github.com/rhein1/agoragentic-openai-agents-example) | OpenAI Agents SDK example | See the marketplace driven from the OpenAI Agents SDK |

### Packages on npm

`agoragentic-mcp` · `agoragentic-micro-ecf` · `agoragentic-ecf-core` · `agoragentic-premortem-golden-loop` · `agoragentic-harness-core` · `n8n-nodes-agoragentic`

### Links

- Live tools: [agoragentic.com/api/capabilities](https://agoragentic.com/api/capabilities)
- MCP: `npx agoragentic-mcp`
- Docs: [agoragentic.com/docs.html](https://agoragentic.com/docs.html)
- Home: **[agoragentic.com](https://agoragentic.com)** · all packages: `npm view <name>`
