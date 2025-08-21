# Example MCP Client Configuration

This document shows how to configure various MCP clients to use the Huly MCP Server.

## Claude Desktop Configuration

Add the following to your Claude Desktop MCP configuration file:

### Using npx (Recommended - No installation required)

**With local Huly server:**
```json
{
  "mcpServers": {
    "huly": {
      "command": "npx",
      "args": ["-y", "huly-mcp-server"],
      "env": {
        "HULY_URL": "http://localhost:8087",
        "HULY_WORKSPACE": "ws1",
        "HULY_EMAIL": "user1",
        "HULY_PASSWORD": "1234"
      }
    }
  }
}
```

**With Huly Cloud:**
```json
{
  "mcpServers": {
    "huly": {
      "command": "npx",
      "args": ["-y", "huly-mcp-server"],
      "env": {
        "HULY_URL": "https://app.huly.io",
        "HULY_WORKSPACE": "your-workspace",
        "HULY_TOKEN": "your-huly-token"
      }
    }
  }
}
```

### Using global installation

First install globally:
```bash
npm install -g huly-mcp-server
```

**With local Huly server:**
```json
{
  "mcpServers": {
    "huly": {
      "command": "huly-mcp-server",
      "env": {
        "HULY_URL": "http://localhost:8087",
        "HULY_WORKSPACE": "ws1",
        "HULY_EMAIL": "user1",
        "HULY_PASSWORD": "1234"
      }
    }
  }
}
```

**With Huly Cloud:**
```json
{
  "mcpServers": {
    "huly": {
      "command": "huly-mcp-server",
      "env": {
        "HULY_URL": "https://app.huly.io",
        "HULY_WORKSPACE": "your-workspace",
        "HULY_TOKEN": "your-huly-token"
      }
    }
  }
}
```

### Using local development build

**With local Huly server:**
```json
{
  "mcpServers": {
    "huly": {
      "command": "node",
      "args": ["/path/to/huly-mcp-server/dist/index.js"],
      "env": {
        "HULY_URL": "http://localhost:8087",
        "HULY_WORKSPACE": "ws1",
        "HULY_EMAIL": "user1",
        "HULY_PASSWORD": "1234"
      }
    }
  }
}
```

**With Huly Cloud:**
```json
{
  "mcpServers": {
    "huly": {
      "command": "node",
      "args": ["/path/to/huly-mcp-server/dist/index.js"],
      "env": {
        "HULY_URL": "https://app.huly.io",
        "HULY_WORKSPACE": "your-workspace",
        "HULY_TOKEN": "your-huly-token"
      }
    }
  }
}
```

## Testing with MCP Inspector

You can test the server using the MCP Inspector:

**With npx (recommended):**
```bash
npx @modelcontextprotocol/inspector npx -y huly-mcp-server
```

**With local build:**
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Available Tools

Once connected, you can use these tools in your MCP client:

### List Issues
```
Use the "list-issues" tool with:
- projectIdentifier: "HULY" (or any project identifier)
- limit: 10 (optional)
- sortBy: "modifiedOn" (optional: modifiedOn, createdOn, title)
- sortOrder: "desc" (optional: asc, desc)
```

### Create Issue
```
Use the "create-issue" tool with:
- projectIdentifier: "HULY"
- title: "Issue title"
- description: "Issue description in markdown"
- priority: "Normal" (optional: Urgent, High, Normal, Low)
```

### Get Issue Details
```
Use the "get-issue" tool with:
- issueIdentifier: "HULY-123"
```

### List Projects
```
Use the "list-projects" tool with:
- limit: 50 (optional)
```

## Available Resources

### Project Information
```
Access project data with URI: huly://project/HULY
```

### Issue Details
```
Access issue data with URI: huly://issue/HULY-123
```

## Available Prompts

### Issue Creation Template
```
Use "create-issue-template" prompt with:
- projectType: "bug" (or feature, task, improvement)
- urgency: "high" (or low, medium, high, critical)
```

### Project Review Template
```
Use "project-review-template" prompt with:
- projectIdentifier: "HULY"
- reviewType: "sprint" (or milestone, quarterly)
```