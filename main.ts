import { OpenAPIV3 } from "openapi-types";

// Types for our OpenAPI to MCP conversion
interface OpenAPIConfig {
  specification: OpenAPIV3.Document;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

interface MCPToolParameter {
  name: string;
  description?: string;
  required: boolean;
  schema: OpenAPIV3.SchemaObject;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  operation: {
    method: string;
    path: string;
    parameters: MCPToolParameter[];
  };
}

class OpenAPIParser {
  private config: OpenAPIConfig;

  constructor(config: OpenAPIConfig) {
    this.config = config;
  }

  /**
   * Convert OpenAPI specification into MCP tools
   */
  public generateTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    const paths = this.config.specification.paths || {};

    // Iterate through all paths and methods
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;

      // Convert each HTTP method to a tool
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!this.isHttpMethod(method) || !operation) continue;

        const tool = this.createToolFromOperation(
          method,
          path,
          operation as OpenAPIV3.OperationObject,
        );
        if (tool) {
          tools.push(tool);
        }
      }
    }

    return tools;
  }

  private isHttpMethod(method: string): method is OpenAPIV3.HttpMethods {
    return [
      "get",
      "put",
      "post",
      "delete",
      "options",
      "head",
      "patch",
      "trace",
    ].includes(method.toLowerCase());
  }

  private createToolFromOperation(
    method: string,
    path: string,
    operation: OpenAPIV3.OperationObject,
  ): MCPTool | null {
    try {
      // Generate a unique name for the tool
      const name = this.generateToolName(
        operation.operationId || `${method}_${path}`,
      );

      // Collect all parameters (path, query, body)
      const parameters = this.collectParameters(operation, path);

      // Create input schema from parameters
      const inputSchema = this.createInputSchema(parameters);

      return {
        name,
        description:
          operation.description ||
          operation.summary ||
          `${method.toUpperCase()} ${path}`,
        inputSchema,
        operation: {
          method: method.toUpperCase(),
          path,
          parameters,
        },
      };
    } catch (error) {
      console.error(`Failed to create tool for ${method} ${path}:`, error);
      return null;
    }
  }

  private generateToolName(baseId: string): string {
    // Convert to snake_case and ensure uniqueness
    return baseId
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/([A-Z])/g, "_$1")
      .toLowerCase()
      .replace(/^_/, "")
      .replace(/_+/g, "_");
  }

  private collectParameters(
    operation: OpenAPIV3.OperationObject,
    path: string,
  ): MCPToolParameter[] {
    const parameters: MCPToolParameter[] = [];

    // Add path parameters
    const pathParams = path.match(/{([^}]+)}/g) || [];
    pathParams.forEach((param) => {
      const paramName = param.slice(1, -1);
      parameters.push({
        name: paramName,
        description: `Path parameter: ${paramName}`,
        required: true,
        schema: { type: "string" },
      });
    });

    // Add operation parameters
    operation.parameters?.forEach((param) => {
      if (!("name" in param)) return; // Skip references for now
      parameters.push({
        name: param.name,
        description: param.description,
        required: param.required || false,
        schema: ((param as OpenAPIV3.ParameterObject)
          .schema as OpenAPIV3.SchemaObject) || {
          type: "string",
        },
      });
    });

    // Add request body if present
    if (operation.requestBody && "content" in operation.requestBody) {
      const content = operation.requestBody.content["application/json"];
      if (content?.schema) {
        parameters.push({
          name: "body",
          description: "Request body",
          required: operation.requestBody.required || false,
          schema: content.schema as Record<string, unknown>,
        });
      }
    }

    return parameters;
  }

  private createInputSchema(
    parameters: MCPToolParameter[],
  ): MCPTool["inputSchema"] {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    parameters.forEach((param) => {
      properties[param.name] = param.schema;
      if (param.required) {
        required.push(param.name);
      }
    });

    return {
      type: "object",
      properties,
      required,
    };
  }
}

class ToolExecutor {
  private config: OpenAPIConfig;

  constructor(config: OpenAPIConfig) {
    this.config = config;
  }

  /**
   * Execute a tool by making an HTTP request
   */
  public async executeTool(
    tool: MCPTool,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      // Build the URL with path parameters
      let url = this.buildUrl(tool.operation.path, args);

      // Add query parameters
      url = this.addQueryParameters(url, tool.operation.parameters, args);

      // Prepare request body
      const body = this.prepareRequestBody(tool.operation.parameters, args);

      // Prepare headers
      const headers = this.prepareHeaders(body);

      // Make the request
      const response = await fetch(url, {
        method: tool.operation.method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle the response
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Parse response based on content type
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        return await response.json();
      } else {
        return await response.text();
      }
    } catch (error) {
      console.error(`Error executing tool ${tool.name}:`, error);
      throw error;
    }
  }

  private buildUrl(path: string, args: Record<string, unknown>): string {
    let url = `${this.config.baseUrl}${path}`;

    // Replace path parameters
    url = url.replace(/{([^}]+)}/g, (_, param) => {
      const value = args[param];
      if (value === undefined) {
        throw new Error(`Missing required path parameter: ${param}`);
      }
      return encodeURIComponent(String(value));
    });

    return url;
  }

  private addQueryParameters(
    url: string,
    parameters: MCPToolParameter[],
    args: Record<string, unknown>,
  ): string {
    const queryParams = new URLSearchParams();

    parameters.forEach((param) => {
      const value = args[param.name];
      if (value !== undefined) {
        queryParams.append(param.name, String(value));
      }
    });

    const queryString = queryParams.toString();
    return queryString ? `${url}?${queryString}` : url;
  }

  private prepareRequestBody(
    parameters: MCPToolParameter[],
    args: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const bodyParam = parameters.find((p) => p.name === "body");
    if (bodyParam && args.body) {
      return args.body as Record<string, unknown>;
    }
    return undefined;
  }

  private prepareHeaders(body?: Record<string, unknown>): Headers {
    const headers = new Headers(this.config.headers);

    // Add content type for JSON requests
    if (body) {
      headers.set("Content-Type", "application/json");
    }

    // Add API key if configured
    if (this.config.apiKey) {
      headers.set("Authorization", `Bearer ${this.config.apiKey}`);
    }

    return headers;
  }
}

// Usage example:
async function initializeOpenAPIMCP(
  specUrl: string,
  config: Partial<OpenAPIConfig>,
) {
  // Fetch and parse OpenAPI spec
  const response = await fetch(specUrl);
  const specification = (await response.json()) as OpenAPIV3.Document;

  // Create configuration
  const fullConfig: OpenAPIConfig = {
    specification,
    baseUrl: config.baseUrl || specification.servers?.[0]?.url || "",
    apiKey: config.apiKey,
    headers: config.headers,
  };

  // Create parser and executor
  const parser = new OpenAPIParser(fullConfig);
  const executor = new ToolExecutor(fullConfig);

  // Generate tools
  const tools = parser.generateTools();

  return {
    tools,
    executor,
  };
}

// Types for MCP messages and data structures
interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

interface MCPSession {
  initialized: boolean;
  protocolVersion: string;
  clientCapabilities: Record<string, unknown>;
  tools: MCPTool[];
}

class MCPHandler {
  private sessions: Map<string, MCPSession> = new Map();
  private readonly supportedVersions = ["2024-11-05"];
  private tools: MCPTool[] = [];
  private executor?: ToolExecutor; // Add executor property

  constructor() {
    // Initialize with empty tool set - will be populated from OpenAPI spec
    this.tools = [];
  }

  public setExecutor(executor: ToolExecutor): void {
    this.executor = executor;
  }

  async handleRequest(
    sessionId: string,
    message: JsonRpcMessage,
  ): Promise<JsonRpcMessage> {
    // Ensure valid JSON-RPC 2.0 message
    if (message.jsonrpc !== "2.0") {
      return this.createError(-32600, "Invalid JSON-RPC version");
    }

    // Handle message based on type and method
    if (message.method === "initialize") {
      return this.handleInitialize(sessionId, message);
    }

    // Ensure session is initialized for all other messages
    const session = this.sessions.get(sessionId);
    if (!session?.initialized && message.method !== "ping") {
      return this.createError(-32001, "Session not initialized");
    }

    // Route message to appropriate handler
    switch (message.method) {
      case "ping":
        return this.handlePing(message);
      case "tools/list":
        return this.handleToolsList(message);
      case "tools/call":
        return this.handleToolCall(message);
      case "initialized":
        return this.handleInitialized(sessionId, message);
      default:
        return this.createError(-32601, "Method not found");
    }
  }

  private handleInitialize(
    sessionId: string,
    message: JsonRpcMessage,
  ): JsonRpcMessage {
    const params = message.params as
      | { protocolVersion: string; capabilities: Record<string, unknown> }
      | undefined;

    // Validate required parameters
    if (!params?.protocolVersion) {
      return this.createError(-32602, "Missing protocol version");
    }

    // Check protocol version compatibility
    if (!this.supportedVersions.includes(params.protocolVersion)) {
      return this.createError(-32602, "Unsupported protocol version", {
        supported: this.supportedVersions,
        requested: params.protocolVersion,
      });
    }

    // Create new session
    this.sessions.set(sessionId, {
      initialized: false,
      protocolVersion: params.protocolVersion,
      clientCapabilities: params.capabilities || {},
      tools: this.tools,
    });

    // Return server capabilities
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: params.protocolVersion,
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
        serverInfo: {
          name: "OpenAPI-MCP-Bridge",
          version: "1.0.0",
        },
      },
    };
  }

  private handleInitialized(
    sessionId: string,
    message: JsonRpcMessage,
  ): JsonRpcMessage {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.initialized = true;
    }

    // Initialized is a notification and doesn't expect a response
    return {
      jsonrpc: "2.0",
    };
  }

  private handlePing(message: JsonRpcMessage): JsonRpcMessage {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {},
    };
  }

  private handleToolsList(message: JsonRpcMessage): JsonRpcMessage {
    const params = message.params as { cursor?: string } | undefined;
    const pageSize = 50; // Configure as needed

    // Get tools for current page
    let tools = [...this.tools];
    if (params?.cursor) {
      const startIndex = parseInt(params.cursor);
      tools = tools.slice(startIndex, startIndex + pageSize);
    } else {
      tools = tools.slice(0, pageSize);
    }

    // Calculate next cursor
    const nextCursor =
      tools.length === pageSize
        ? (params?.cursor
            ? parseInt(params.cursor) + pageSize
            : pageSize
          ).toString()
        : undefined;

    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools,
        nextCursor,
      },
    };
  }

  private async handleToolCall(
    message: JsonRpcMessage,
  ): Promise<JsonRpcMessage> {
    const params = message.params as
      | { name: string; arguments: Record<string, unknown> }
      | undefined;

    // Validate parameters
    if (!params?.name) {
      return this.createError(-32602, "Missing tool name");
    }

    // Find requested tool
    const tool = this.tools.find((t) => t.name === params.name);
    if (!tool) {
      return this.createError(-32602, "Tool not found");
    }

    try {
      // Execute tool (implementation will be added later)
      const result = await this.executeTool(tool, params.arguments || {});

      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
          isError: false,
        },
      };
    } catch (error) {
      return this.createError(-32603, "Tool execution failed", error);
    }
  }

  private async executeTool(
    tool: MCPTool,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.executor) {
      throw new Error("Tool executor not initialized");
    }

    try {
      // Validate required arguments based on tool's inputSchema
      this.validateToolArguments(tool, args);

      // Execute the tool using the executor
      const result = await this.executor.executeTool(tool, args);
      return result;
    } catch (error) {
      console.error(`Error executing tool ${tool.name}:`, error);
      throw error;
    }
  }

  // Add helper method for argument validation
  private validateToolArguments(
    tool: MCPTool,
    args: Record<string, unknown>,
  ): void {
    const { required, properties } = tool.inputSchema;

    // Check required arguments
    for (const requiredArg of required) {
      if (!(requiredArg in args)) {
        throw new Error(`Missing required argument: ${requiredArg}`);
      }
    }

    // Validate argument types (basic validation)
    for (const [argName, value] of Object.entries(args)) {
      const schema = properties[argName] as OpenAPIV3.SchemaObject;
      if (!schema) {
        throw new Error(`Unknown argument: ${argName}`);
      }

      // Basic type checking
      if (schema.type === "string" && typeof value !== "string") {
        throw new Error(`Invalid type for ${argName}: expected string`);
      }
      if (schema.type === "number" && typeof value !== "number") {
        throw new Error(`Invalid type for ${argName}: expected number`);
      }
      if (schema.type === "boolean" && typeof value !== "boolean") {
        throw new Error(`Invalid type for ${argName}: expected boolean`);
      }
      if (
        schema.type === "object" &&
        (typeof value !== "object" || value === null)
      ) {
        throw new Error(`Invalid type for ${argName}: expected object`);
      }
      if (schema.type === "array" && !Array.isArray(value)) {
        throw new Error(`Invalid type for ${argName}: expected array`);
      }
    }
  }

  // Update tools (will be called when OpenAPI spec changes)
  public updateTools(tools: MCPTool[]): void {
    this.tools = tools;

    // Notify all sessions that tool list has changed
    // In a real implementation, we'd send notifications to connected clients
  }

  private createError(
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcMessage {
    return {
      jsonrpc: "2.0",
      error: {
        code,
        message,
        data,
      },
    };
  }
}

interface Env {
  OPENAPI_SPEC_URL?: string;
  API_BASE_URL?: string;
  API_KEY?: string;
}

// Cloudflare Worker request handler
export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    // Parse session ID from request (e.g., from header or URL)
    const sessionId = request.headers.get("X-Session-ID") || "default";

    try {
      // Initialize OpenAPI MCP integration
      const { tools, executor } = await initializeOpenAPIMCP(
        env.OPENAPI_SPEC_URL || "",
        {
          baseUrl: env.API_BASE_URL,
          apiKey: env.API_KEY,
        },
      );

      // Create MCP handler if needed (in practice, you'd want to persist this)
      const handler = new MCPHandler();
      handler.updateTools(tools);

      // Set the tool executor
      handler.setExecutor(executor);

      // Parse JSON-RPC message from request
      const message = (await request.json()) as JsonRpcMessage;

      // Handle the message
      const response = await handler.handleRequest(sessionId, message);

      // Return JSON-RPC response
      return new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Server error",
            data: error instanceof Error ? error.message : String(error),
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 500,
        },
      );
    }
  },
};
