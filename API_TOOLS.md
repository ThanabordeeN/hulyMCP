# Huly MCP Server - Complete API Tools

The Huly MCP server now provides comprehensive project management capabilities through MCP tools, covering all aspects of project lifecycle from planning to reporting.

## Available Tools

### Project Management Capabilities

#### create-project
Create a new Huly project with comprehensive configuration.
```json
{
  "name": "Project Name",
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

### Project Planning Capabilities

#### create-sprint
Create a new sprint in a project.
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
Move issues to a sprint with optional filters.
```json
{
  "projectIdentifier": "PROJ",
  "sprintName": "Sprint 1",
  "issueIdentifiers": ["PROJ-1", "PROJ-2"],
  "filters": {
    "status": "open",
    "priority": "High"
  }
}
```

### Enhanced Issue & Component Management

#### create-issue
Create a new issue in a Huly project.
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
  "description": "Updated description",
  "priority": "Urgent",
  "assignee": "user@example.com",
  "component": "Frontend",
  "estimation": 5,
  "dueDate": "2024-01-15",
  "labels": ["bug", "frontend"],
  "customFields": {"severity": "critical"}
}
```

#### change-issue-status
Change issue status with guard checks.
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
List issues in a Huly project.
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

### Reporting & Search Capabilities

#### generate-sprint-report
Generate comprehensive sprint reports (burndown, velocity, bottleneck analysis).
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
  "query": "search term",
  "modules": ["task", "document", "contact"],
  "limit": 20
}
```

#### export-data
Export data in CSV or JSON format.
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

### Core Document Operations

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

#### update-doc
Update an existing document.
```json
{
  "className": "tracker.class.Issue",
  "spaceName": "tracker.space.Project",
  "objectId": "issue-id",
  "operations": {"title": "Updated Title"},
  "retrieve": true
}
```

#### remove-doc
Remove a document.
```json
{
  "className": "tracker.class.Issue",
  "spaceName": "tracker.space.Project",
  "objectId": "issue-id"
}
```

### Collection Operations

#### add-collection
Add a new item to a collection.
```json
{
  "className": "tracker.class.IssueComment",
  "spaceName": "tracker.space.Project",
  "attachedTo": "issue-id",
  "attachedToClass": "tracker.class.Issue",
  "collection": "comments",
  "attributes": {"message": "Comment text"},
  "id": "optional-custom-id"
}
```

#### update-collection
Update an existing collection item.
```json
{
  "className": "tracker.class.IssueComment",
  "spaceName": "tracker.space.Project",
  "objectId": "comment-id",
  "attachedTo": "issue-id",
  "attachedToClass": "tracker.class.Issue",
  "collection": "comments",
  "attributes": {"message": "Updated comment"}
}
```

#### remove-collection
Remove an item from a collection.
```json
{
  "className": "tracker.class.IssueComment",
  "spaceName": "tracker.space.Project",
  "objectId": "comment-id",
  "attachedTo": "issue-id",
  "attachedToClass": "tracker.class.Issue",
  "collection": "comments"
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

## Class Name Format

All class names should use the format: `module.class.ClassName`

Examples:
- `tracker.class.Issue`
- `tracker.class.Project`
- `tracker.class.Component`
- `tracker.class.Sprint`
- `contact.class.Person`
- `contact.class.Channel`
- `task.class.ProjectType`
- `core.space.Space`

## Supported Modules

Currently supported modules:
- `tracker` - Issue tracking and project management functionality
- `core` - Core Huly objects
- `task` - Task and project management
- `contact` - Contact management (limited support)

## Error Handling

All tools include comprehensive error handling and will return descriptive error messages for:
- Invalid class names
- Missing required parameters  
- Connection failures
- API errors
- Permission issues

## Usage Examples

### Complete Project Setup Workflow

1. **Create Project**:
```json
{
  "name": "My New Project",
  "identifier": "MNP",
  "description": "A comprehensive project",
  "visibility": "public",
  "timezone": "UTC"
}
```

2. **Create Components**:
```json
{
  "projectIdentifier": "MNP",
  "name": "Backend",
  "description": "Backend services",
  "lead": "backend-lead@example.com"
}
```

3. **Create Sprint**:
```json
{
  "projectIdentifier": "MNP",
  "name": "Sprint 1",
  "startDate": "2024-01-01",
  "endDate": "2024-01-14",
  "capacity": 80
}
```

4. **Create Issues**:
```json
{
  "projectIdentifier": "MNP",
  "title": "Implement user authentication",
  "description": "Implement secure user authentication system",
  "priority": "High"
}
```

5. **Generate Reports**:
```json
{
  "projectIdentifier": "MNP",
  "sprintName": "Sprint 1",
  "reportType": "summary"
}
```

## Response Format

All tools return responses in the format:
```json
{
  "content": [{
    "type": "text",
    "text": "Response message or data"
  }],
  "isError": false
}
```

Error responses include `"isError": true` and descriptive error messages.