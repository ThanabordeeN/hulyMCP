# Huly MCP Server - Complete API Tools

The Huly MCP server now provides comprehensive access to all Huly Platform API methods through MCP tools.

## Available Tools

### Core Document Operations

#### find-one
Find a single document by class and query criteria.
```json
{
  "className": "tracker.class.Issue",
  "query": {"identifier": "HULY-123"},
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
  "className": "contact.class.Person",
  "spaceName": "contact.space.Contacts",
  "objectId": "person-id",
  "operations": {"city": "San Francisco"},
  "retrieve": true
}
```

#### remove-doc
Remove an existing document.
```json
{
  "className": "contact.class.Person",
  "spaceName": "contact.space.Contacts",
  "objectId": "person-id"
}
```

### Collection Operations

#### add-collection
Create a new attached document in a collection.
```json
{
  "className": "contact.class.Channel",
  "spaceName": "contact.space.Contacts",
  "attachedTo": "person-id",
  "attachedToClass": "contact.class.Person",
  "collection": "channels",
  "attributes": {
    "provider": "email",
    "value": "john@example.com"
  }
}
```

#### update-collection
Update an existing attached document in a collection.
```json
{
  "className": "contact.class.Channel",
  "spaceName": "contact.space.Contacts",
  "objectId": "channel-id",
  "attachedTo": "person-id",
  "attachedToClass": "contact.class.Person",
  "collection": "channels",
  "attributes": {"value": "newemail@example.com"}
}
```

#### remove-collection
Remove an existing attached document from a collection.
```json
{
  "className": "contact.class.Channel",
  "spaceName": "contact.space.Contacts", 
  "objectId": "channel-id",
  "attachedTo": "person-id",
  "attachedToClass": "contact.class.Person",
  "collection": "channels"
}
```

### Mixin Operations

#### create-mixin
Create a new mixin for a specified document.
```json
{
  "objectId": "person-id",
  "objectClass": "contact.class.Person",
  "objectSpace": "contact.space.Contacts",
  "mixin": "contact.mixin.Employee",
  "attributes": {
    "active": true,
    "position": "CEO"
  }
}
```

#### update-mixin
Update an existing mixin.
```json
{
  "objectId": "person-id", 
  "objectClass": "contact.class.Person",
  "objectSpace": "contact.space.Contacts",
  "mixin": "contact.mixin.Employee",
  "attributes": {"active": false}
}
```

### Huly-Specific Tools

#### list-issues
List issues in a Huly project.
```json
{
  "projectIdentifier": "HULY",
  "limit": 20,
  "sortBy": "modifiedOn",
  "sortOrder": "desc"
}
```

#### create-issue
Create a new issue in a Huly project.
```json
{
  "projectIdentifier": "HULY",
  "title": "Bug fix needed",
  "description": "Description in **markdown**",
  "priority": "High",
  "assignee": "user@example.com"
}
```

#### list-projects
List all projects.
```json
{
  "limit": 50
}
```

#### get-issue
Get detailed information about a specific issue.
```json
{
  "issueIdentifier": "HULY-123"
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
- `contact.class.Person`
- `contact.class.Channel`
- `task.class.ProjectType`
- `core.space.Space`

## Supported Modules

Currently supported modules:
- `tracker` - Issue tracking functionality
- `core` - Core Huly objects
- `task` - Task and project management

## Error Handling

All tools include comprehensive error handling and will return descriptive error messages for:
- Invalid class names
- Missing required parameters  
- Connection failures
- API errors
- Permission issues

## Usage Examples

### Create a Person with Contact Info
1. Create person: Use `create-doc` with `contact.class.Person`
2. Add email: Use `add-collection` with `contact.class.Channel`

### Update Issue Status
1. Find issue: Use `find-one` with `tracker.class.Issue`
2. Update status: Use `update-doc` to change status field

### Query Complex Data
Use `find-all` with lookup options to get related data in a single call.

## Response Format

All tools return structured responses with:
- `content`: Array of content blocks
- `isError`: Boolean flag for errors
- Detailed success/error messages
- JSON formatted data when applicable
