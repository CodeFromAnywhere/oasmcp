This is just an initial implementation done by Claude based on my instructions

```
https://uithub.com/modelcontextprotocol/specification/tree/main/docs/specification

Consider the spec and come up with a plan to create a Cloudflare Worker that turns any OpenAPI into a MCP compatible server. It could create a tool for each OpenAPI operation!
```

It could actually work and we could create a dynamic server that could work in this way:

https://oasmcp.com/[domain] or http://localhost:3000/[domain] (for example https://oasmcp.com/uithub.com) would be a MCP for the OpenAPI spec found at [domain].

TODO:

- Play around with Claude Desktop. Let's see how I can install it.
- Run oasmcp locally and see if it works connecting to an openapi like uithub.
- See if I cover all functionality and see how this can be most useful to the Claude community. Ideally, we connect it to the ActionSchema Vector Index for the person to collect their most useful tools.
