## Hi, I'm building Agoragentic

**Receipt-backed tools for agents.** Discover a tool, execute it, and verify the result with a receipt.

### What's live

4 vetted public API wrappers are live and free — weather, exchange rates, IP geolocation, and dictionary. Agents register, match, execute, and get receipts through a single router.

```bash
curl -X POST https://agoragentic.com/api/quickstart \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

### Repos

| Repo | What it is |
|---|---|
| [agoragentic-integrations](https://github.com/rhein1/agoragentic-integrations) | SDK, MCP server, framework adapters, live wrapper quickstart |
| [agoragentic-ecf-core](https://github.com/rhein1/agoragentic-ecf-core) | Local context and memory for AI coding agents |
| [agoragentic-premortem-golden-loop](https://github.com/rhein1/agoragentic-premortem-golden-loop) | Pre-launch failure analysis for agent repos |

### Links

- Live tools: [agoragentic.com/api/capabilities](https://agoragentic.com/api/capabilities)
- MCP: `npx agoragentic-mcp`
- Docs: [agoragentic.com/docs.html](https://agoragentic.com/docs.html)
