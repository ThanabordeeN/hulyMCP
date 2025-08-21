# Huly MCP Server - Jira-Compatible API Tools

The Huly MCP server now provides comprehensive Jira and Confluence-compatible project management capabilities through MCP tools, covering all aspects of project lifecycle from planning to reporting with enhanced security features.

## Enhanced Security Features

- **Input Validation**: All inputs are validated using Zod schemas with strict type checking
- **Injection Prevention**: Built-in sanitization prevents SQL/NoSQL injection attacks
- **Parameter Limits**: Enforced limits on string lengths, array sizes, and numeric ranges
- **Safe Query Building**: Secure query construction with parameterized inputs
- **Error Handling**: Comprehensive error handling with descriptive messages

## Available Tools

### JIRA READ OPERATIONS

#### jira_get_project_issues
Retrieve all issues from a specific project with comprehensive filtering and sorting capabilities.
```json
{
  "projectIdentifier": "PROJ",
  "limit": 50,
  "sortBy": "modifiedOn",
  "sortOrder": "desc",
  "status": "In Progress",
  "assignee": "user@example.com",
  "priority": "High"
}
```

#### jira_get_issue
Retrieve comprehensive details for a specific issue by its identifier.
```json
{
  "issueIdentifier": "PROJ-123",
  "includeComments": true,
  "includeHistory": true,
  "includeAttachments": false
}
```

#### jira_get_all_projects
Retrieve a comprehensive list of all accessible projects with metadata.
```json
{
  "limit": 100,
  "includeArchived": false,
  "sortBy": "name",
  "sortOrder": "asc",
  "projectType": "software"
}
```

#### jira_search
Advanced search across all accessible issues with comprehensive filtering.
```json
{
  "query": "bug in login",
  "projectIdentifier": "PROJ",
  "status": "Open",
  "priority": "High",
  "limit": 50,
  "sortBy": "relevance"
}
```

### JIRA WRITE OPERATIONS

#### jira_create_issue
Create a new issue in the specified project with comprehensive field support.
```json
{
  "projectIdentifier": "PROJ",
  "title": "Bug fix needed in authentication",
  "description": "Detailed description in **markdown**",
  "priority": "High",
  "issueType": "Bug",
  "assignee": "user@example.com",
  "component": "Authentication",
  "estimation": 8,
  "dueDate": "2024-01-15T00:00:00.000Z",
  "labels": ["security", "urgent"],
  "parentIssue": "PROJ-100"
}
```

#### jira_update_issue
Update an existing issue with comprehensive field support and validation.
```json
{
  "issueIdentifier": "PROJ-123",
  "title": "Updated issue title",
  "priority": "Urgent",
  "status": "In Progress",
  "assignee": "newuser@example.com",
  "estimation": 12,
  "comment": "Increased priority due to customer impact"
}
```

### PLANNED JIRA TOOLS (To be implemented)

#### Read Operations
- `jira_get_worklog` - Get worklog entries for an issue
- `jira_get_transitions` - Get available status transitions for an issue
- `jira_search_fields` - Search custom fields and their values
- `jira_get_agile_boards` - Get all agile boards
- `jira_get_board_issues` - Get issues from a specific board
- `jira_get_sprints_from_board` - Get sprints from a board
- `jira_get_sprint_issues` - Get issues from a specific sprint
- `jira_get_issue_link_types` - Get available issue link types
- `jira_batch_get_changelogs` - Get change history for multiple issues
- `jira_get_user_profile` - Get user profile information
- `jira_download_attachments` - Download issue attachments
- `jira_get_project_versions` - Get project versions/releases

#### Write Operations
- `jira_delete_issue` - Delete an issue (with confirmation)
- `jira_batch_create_issues` - Create multiple issues in batch
- `jira_add_comment` - Add comment to an issue
- `jira_transition_issue` - Change issue status/workflow
- `jira_add_worklog` - Log work time on an issue
- `jira_link_to_epic` - Link issue to an epic
- `jira_create_sprint` - Create a new sprint
- `jira_update_sprint` - Update sprint details
- `jira_create_issue_link` - Create link between issues
- `jira_remove_issue_link` - Remove link between issues
- `jira_create_version` - Create project version/release
- `jira_batch_create_versions` - Create multiple versions in batch

### PLANNED CONFLUENCE TOOLS (To be implemented)

#### Read Operations
- `confluence_search` - Search confluence content
- `confluence_get_page` - Get specific page content
- `confluence_get_page_children` - Get child pages
- `confluence_get_comments` - Get page comments
- `confluence_get_labels` - Get page labels
- `confluence_search_user` - Search for users

#### Write Operations
- `confluence_create_page` - Create new page
- `confluence_update_page` - Update existing page
- `confluence_delete_page` - Delete page
- `confluence_add_label` - Add label to page
- `confluence_add_comment` - Add comment to page

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