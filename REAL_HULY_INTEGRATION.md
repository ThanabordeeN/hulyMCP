# Integrating with Real Huly API

This MCP server currently uses a mock implementation for demonstration purposes. To connect to a real Huly instance, follow these steps:

## Prerequisites

1. **GitHub Access Token**: The Huly packages are published to GitHub's npm registry and require authentication.

2. **Create `.npmrc` file** with your GitHub token:
```
@hcengineering:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=your_github_token_here
```

## Install Real Huly Dependencies

Update `package.json` to include the real Huly packages:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.3",
    "@hcengineering/api-client": "^0.7.144",
    "@hcengineering/core": "^0.7.144",
    "@hcengineering/document": "^0.7.144",
    "@hcengineering/rank": "^0.7.144",
    "@hcengineering/tracker": "^0.7.144",
    "@hcengineering/tags": "^0.7.144",
    "ws": "^8.16.0",
    "zod": "^3.23.8"
  }
}
```

## Update the Implementation

Replace the mock implementation files:

1. **Remove mock files**:
   - `src/mock-huly-client.ts`
   - `src/huly-types.ts`

2. **Update `src/huly-connection.ts`**:
```typescript
import { ConnectOptions, NodeWebSocketFactory, connect, Client as HulyClient } from '@hcengineering/api-client';
import { HulyConfig, defaultConfig } from './config.js';

export class HulyConnection {
  private client: HulyClient | null = null;
  private config: HulyConfig;

  constructor(config: HulyConfig) {
    this.config = { ...defaultConfig, ...config };
  }

  async connect(): Promise<HulyClient> {
    if (this.client) {
      return this.client;
    }

    const options: ConnectOptions = {
      workspace: this.config.workspace,
      socketFactory: NodeWebSocketFactory,
      connectionTimeout: this.config.connectionTimeout || 30000,
    };

    // Add authentication options
    if (this.config.token) {
      options.token = this.config.token;
    } else if (this.config.email && this.config.password) {
      options.email = this.config.email;
      options.password = this.config.password;
    } else {
      throw new Error('Either token or email/password must be provided for Huly authentication');
    }

    try {
      this.client = await connect(this.config.url, options);
      return this.client;
    } catch (error) {
      throw new Error(`Failed to connect to Huly: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  getClient(): HulyClient {
    if (!this.client) {
      throw new Error('Not connected to Huly. Call connect() first.');
    }
    return this.client;
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}
```

3. **Update `src/huly-mcp-server.ts` imports**:
```typescript
import { SortingOrder, generateId, type Ref } from '@hcengineering/core';
import core from '@hcengineering/core';
import tracker, { type Issue, type Project, IssuePriority } from '@hcengineering/tracker';
import task from '@hcengineering/task';
import { makeRank } from '@hcengineering/rank';
```

## Huly Setup

1. **Local Huly Development**:
   Follow the [Huly Platform setup guide](https://github.com/hcengineering/platform) to run Huly locally.

2. **Huly Cloud**:
   - Sign up at [huly.app](https://huly.app)
   - Create a workspace
   - Generate an API token from your account settings

## Configuration

Set environment variables:

```bash
# For local development
export HULY_URL=http://localhost:8087
export HULY_WORKSPACE=ws1
export HULY_EMAIL=user1
export HULY_PASSWORD=1234

# For Huly Cloud
export HULY_URL=https://app.huly.io
export HULY_WORKSPACE=your-workspace-id
export HULY_TOKEN=your-api-token
```

## Testing

Once connected to a real Huly instance, you can:

1. Create real projects and issues
2. Query actual project data
3. Use all the MCP tools with real data
4. Integrate with your existing Huly workflows

## Additional Features

With the real Huly API, you can extend this MCP server to support:

- Document management
- Team member management
- Time tracking
- Custom fields
- Workflow automation
- Reporting and analytics

## Support

For Huly-specific issues:
- [Huly Community Slack](https://huly.link/slack)
- [Huly Platform GitHub](https://github.com/hcengineering/platform)

For MCP-related issues:
- [MCP Specification](https://spec.modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)