# PC2 AgentDock deployment

Validated on 2026-11-04 on PC2 (`RANRAN4060`). MCP is merged into
`feat/ui-design-system-unify` at merge commit `a607445`.

- Source: `D:\a_programming_list\A-Python-Project\wk08\AgentScape`
- Application: `apps/mcp-server/main.mjs`; Studio starts independently.
- AgentDock dynamic server: `agentscape-world`, Streamable HTTP,
  `http://127.0.0.1:39015/mcp`, nine tools.
- Authorization header references the server's isolated environment variable
  `AGENTSCAPE_WORLD_AUTHORIZATION`, configured through `mcp_manage`.
- Windows task `AgentScape-World-MCP` starts a hidden supervisor at the current
  user's logon. It is running now; Node restarts after exit with a five-second delay.
  This is a user logon task, not a system service before logon.
- Supervisor and private runtime files live in
  `C:\Users\yuminghui\.agentdock\agentscape-world`.
  `start.ps1` loads an independent Windows-user-protected credential from
  `credential.clixml`. Do not publish these private files or credential values.
- Exported scenes live in the source checkout's ignored `.mcp-sessions` directory.
  Worlds are in memory and do not survive process restart.

The official SDK unified HTTP handler serves both 2026-07-28 request envelopes
and legacy clients. The original legacy-only transport failed AgentDock discovery.
`tests/mcp/modern-protocol.test.js` covers discovery and tool listing without
a legacy handshake; existing HTTP tests cover the complete physics workflow.

Real AgentDock acceptance created a private world, observed four objects, opened
the cabinet, picked up the cup and placed it on the table. All three actions
returned `verified`; final verification passed six checks and reported empty hands.
Export returned four objects (9140 bytes), and the session was closed.
Full call evidence is saved privately in the runtime directory's `acceptance.json`.

Use `mcp_manage inspect/refresh` for connection health and `mcp_tool_search`,
`mcp_tool_inspect`, `mcp_tool_call` to discover and invoke tools.
To stop maintenance, stop the Windows task and its Node child; stopping only Node
causes the supervisor to restart it. Future Node installations may require updating
the explicit executable path in `start.ps1`.
