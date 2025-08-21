# Example MCP Client Configuration

This document shows how to configure various MCP clients to use the Huly MCP Server with comprehensive project management capabilities.

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

Once connected, you can use these comprehensive tools in your MCP client:

### Project Management

#### create-project
Create a new project with comprehensive configuration.
```json
{
  "name": "New Project",
  "identifier": "PROJ",
  "description": "Project description",
  "visibility": "public",
  "owner": "owner@example.com",
  "timezone": "UTC",
  "type": "project"
}
```

#### update-project
Update an existing project.
```json
{
  "projectIdentifier": "PROJ",
  "name": "Updated Name",
  "description": "Updated description",
  "visibility": "private",
  "archived": false
}
```

#### delete-project
Delete a project (requires confirmation).
```json
{
  "projectIdentifier": "PROJ",
  "confirm": true
}
```

#### list-projects
List all projects.
```json
{
  "limit": 50
}
```

### Component Management

#### create-component
Create a new component in a project.
```json
{
  "projectIdentifier": "PROJ",
  "name": "Frontend",
  "description": "Frontend components",
  "lead": "lead@example.com"
}
```

#### list-components
List components in a project.
```json
{
  "projectIdentifier": "PROJ",
  "limit": 50
}
```

#### update-component
Update an existing component.
```json
{
  "projectIdentifier": "PROJ",
  "componentName": "Frontend",
  "description": "Updated description",
  "lead": "newlead@example.com"
}
```

#### delete-component
Delete a component (requires confirmation).
```json
{
  "projectIdentifier": "PROJ",
  "componentName": "Frontend",
  "confirm": true
}
```

### Sprint & Project Planning

#### create-sprint
Create a new sprint.
```json
{
  "projectIdentifier": "PROJ",
  "name": "Sprint 1",
  "startDate": "2024-01-01",
  "endDate": "2024-01-14",
  "capacity": 80,
  "workingDays": [1, 2, 3, 4, 5]
}
```

#### list-sprints
List sprints in a project.
```json
{
  "projectIdentifier": "PROJ",
  "status": "active",
  "limit": 20
}
```

#### update-sprint
Update an existing sprint.
```json
{
  "projectIdentifier": "PROJ",
  "sprintName": "Sprint 1",
  "capacity": 100,
  "status": "active"
}
```

#### move-issues-to-sprint
Move issues to a sprint with filters.
```json
{
  "projectIdentifier": "PROJ",
  "sprintName": "Sprint 1",
  "filters": {
    "status": "open",
    "priority": "High"
  }
}
```

### Enhanced Issue Management

#### create-issue
Create a new issue.
```json
{
  "projectIdentifier": "PROJ",
  "title": "Bug fix needed",
  "description": "Description in **markdown**",
  "priority": "High",
  "assignee": "user@example.com"
}
```

#### update-issue
Update an existing issue with enhanced capabilities.
```json
{
  "issueIdentifier": "PROJ-123",
  "title": "Updated title",
  "priority": "Urgent",
  "estimation": 5,
  "dueDate": "2024-01-15",
  "component": "Frontend"
}
```

#### change-issue-status
Change issue status with optional comment.
```json
{
  "issueIdentifier": "PROJ-123",
  "newStatus": "in-progress",
  "comment": "Starting work on this issue"
}
```

#### link-issues
Create relationships between issues.
```json
{
  "sourceIssue": "PROJ-123",
  "targetIssue": "PROJ-124",
  "linkType": "blocks"
}
```

#### create-subtask
Create a subtask for an existing issue.
```json
{
  "parentIssue": "PROJ-123",
  "title": "Subtask title",
  "description": "Subtask description",
  "assignee": "user@example.com",
  "estimation": 2
}
```

#### delete-issue
Delete an issue (requires confirmation).
```json
{
  "issueIdentifier": "PROJ-123",
  "confirm": true
}
```

#### list-issues
List issues in a project.
```json
{
  "projectIdentifier": "PROJ",
  "limit": 20,
  "sortBy": "modifiedOn",
  "sortOrder": "desc"
}
```

#### get-issue
Get detailed information about a specific issue.
```json
{
  "issueIdentifier": "PROJ-123"
}
```

### Reporting & Analytics

#### generate-sprint-report
Generate comprehensive sprint reports.
```json
{
  "projectIdentifier": "PROJ",
  "sprintName": "Sprint 1",
  "reportType": "burndown"
}
```

#### cross-module-search
Search across tasks, documents, and contacts.
```json
{
  "query": "bug",
  "modules": ["task", "contact"],
  "limit": 20
}
```

#### export-data
Export project data in CSV or JSON format.
```json
{
  "projectIdentifier": "PROJ",
  "dataType": "issues",
  "format": "csv",
  "filters": {"status": "completed"}
}
```

#### create-saved-filter
Create saved filters for frequent queries.
```json
{
  "name": "High Priority Bugs",
  "description": "All high priority bug issues",
  "query": {"priority": "High", "kind": "bug"},
  "targetClass": "tracker.class.Issue"
}
```

### System Tools

#### connection-status
Check the current connection status to Huly.
```json
{
  "ping": true
}
```

### Generic Document Operations

#### find-one
Find a single document by class and query criteria.
```json
{
  "className": "tracker.class.Issue",
  "query": {"identifier": "PROJ-123"},
  "options": {"lookup": {"type": "task.class.ProjectType"}}
}
```

#### find-all
Find multiple documents by class and query criteria.
```json
{
  "className": "tracker.class.Issue",
  "query": {"space": "project-id"},
  "options": {"limit": 10, "sort": {"modifiedOn": -1}}
}
```

#### create-doc
Create a new document in the specified space.
```json
{
  "className": "contact.class.Person",
  "spaceName": "contact.space.Contacts",
  "attributes": {
    "name": "John Doe",
    "city": "New York"
  }
}
```

## Available Resources

### Project Information
```
Access project data with URI: huly://project/PROJ
```

### Issue Details
```
Access issue data with URI: huly://issue/PROJ-123
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
- projectIdentifier: "PROJ"
- reviewType: "sprint" (or milestone, quarterly)
```