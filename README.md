# Huly MCP Server

An MCP (Model Context Protocol) server implementation that provides access to Huly Platform API functionality. This server allows AI agents and LLM applications to interact with Huly projects, issues, and other platform features through the standardized MCP protocol.

## Features

### Tools
- **list-issues**: List issues in a Huly project with filtering and sorting options
- **create-issue**: Create new issues with title, description, priority, and assignment
- **get-issue**: Get detailed information about specific issues
- **list-projects**: List all available Huly projects

### Resources
- **project-info**: Access detailed project information as JSON
- **issue-details**: Access detailed issue information as JSON

### Prompts
- **create-issue-template**: Templates for creating well-structured issues (bug, feature, task, improvement)
- **project-review-template**: Templates for conducting project reviews (sprint, milestone, quarterly)

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and configure your Huly connection:

```bash
cp .env.example .env
```

Edit `.env` with your Huly server details:

```env
# Huly server URL
HULY_URL=http://localhost:8087

# Workspace identifier
HULY_WORKSPACE=ws1

# Authentication (choose one method)
# Option 1: Token-based authentication
HULY_TOKEN=your_token_here

# Option 2: Email/password authentication
HULY_EMAIL=your_email@example.com
HULY_PASSWORD=your_password
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### Using with MCP Clients

This server communicates via stdin/stdout using the MCP protocol. You can integrate it with any MCP-compatible client.

#### Example with Claude Desktop

Add to your Claude Desktop MCP configuration:

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

## Examples

### List Issues
```typescript
// Tool call: list-issues
{
  "projectIdentifier": "HULY",
  "limit": 10,
  "sortBy": "modifiedOn",
  "sortOrder": "desc"
}
```

### Create Issue
```typescript
// Tool call: create-issue
{
  "projectIdentifier": "HULY",
  "title": "Fix login bug",
  "description": "Users cannot log in with special characters in password",
  "priority": "High"
}
```

### Get Project Information
```typescript
// Resource: huly://project/HULY
// Returns detailed JSON information about the project
```

### Use Issue Creation Template
```typescript
// Prompt: create-issue-template
{
  "projectType": "bug",
  "urgency": "high"
}
```

## API Reference

### Tools

#### list-issues
Lists issues in a specified Huly project.

**Parameters:**
- `projectIdentifier` (string): Project identifier (e.g., "HULY")
- `limit` (number, optional): Maximum number of issues to return (default: 20)
- `sortBy` (enum, optional): Field to sort by - "modifiedOn", "createdOn", "title" (default: "modifiedOn")
- `sortOrder` (enum, optional): Sort order - "asc", "desc" (default: "desc")

#### create-issue
Creates a new issue in a Huly project.

**Parameters:**
- `projectIdentifier` (string): Project identifier
- `title` (string): Issue title
- `description` (string, optional): Issue description in markdown format
- `priority` (enum, optional): Issue priority - "Urgent", "High", "Normal", "Low" (default: "Normal")
- `assignee` (string, optional): Assignee email or ID

#### get-issue
Gets detailed information about a specific issue.

**Parameters:**
- `issueIdentifier` (string): Issue identifier (e.g., "HULY-123")

#### list-projects
Lists all available Huly projects.

**Parameters:**
- `limit` (number, optional): Maximum number of projects to return (default: 50)

### Resources

#### project-info
**URI Pattern:** `huly://project/{identifier}`

Returns detailed project information as JSON.

#### issue-details
**URI Pattern:** `huly://issue/{identifier}`

Returns detailed issue information as JSON.

### Prompts

#### create-issue-template
Provides templates for creating well-structured issues.

**Parameters:**
- `projectType` (enum): Type of issue - "bug", "feature", "task", "improvement"
- `urgency` (enum): Urgency level - "low", "medium", "high", "critical"

#### project-review-template
Provides templates for conducting project reviews.

**Parameters:**
- `projectIdentifier` (string): Project identifier to review
- `reviewType` (enum): Type of review - "sprint", "milestone", "quarterly"

## Requirements

- Node.js >= 18
- Access to a Huly Platform instance
- Valid Huly workspace and authentication credentials

## Dependencies

This MCP server is built on:
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk): MCP TypeScript SDK
- [@hcengineering/*](https://github.com/hcengineering/platform): Huly Platform API clients

## License

MIT
