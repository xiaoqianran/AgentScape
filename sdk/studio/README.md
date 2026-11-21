# AgentScape Studio (optional)

**agentscape3d-studio** contains the bundled Studio and static website, independent of the lightweight semantic Core and its dependencies.

~~~bash
npx agentscape3d-studio web --port 4173
~~~

It binds to 127.0.0.1 by default. Use --host 0.0.0.0 only if sharing with other devices is intended. The package also exposes startStudio({ host, port }) from agentscape3d-studio/cli.

The static site can use a separately configured MCP backend; its presence does not grant an AI agent permissions. Studio execution and approval policies remain application concerns. See docs/sdk-packages.md.
