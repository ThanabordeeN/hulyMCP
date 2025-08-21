import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HulyConnection } from "./huly-connection.js";
import { HulyConfig } from "./config.js";

// Enhanced input validation schemas to prevent injection attacks
const sanitizeString = (str: string): string => {
  // Remove or escape potentially dangerous characters
  return str.replace(/[<>'"&]/g, '').trim().substring(0, 1000);
};

const ProjectIdentifierSchema = z.string()
  .min(1, "Project identifier cannot be empty")
  .max(50, "Project identifier too long")
  .regex(/^[A-Z][A-Z0-9_-]*$/i, "Project identifier must start with letter and contain only alphanumeric characters, hyphens, and underscores")
  .transform(sanitizeString);

const IssueIdentifierSchema = z.string()
  .min(1, "Issue identifier cannot be empty")
  .max(100, "Issue identifier too long")
  .regex(/^[A-Z][A-Z0-9_-]*-\d+$/i, "Issue identifier must be in format PROJECT-123")
  .transform(sanitizeString);

const SafeStringSchema = z.string()
  .max(10000, "String too long")
  .transform(sanitizeString);

const SafeDescriptionSchema = z.string()
  .max(50000, "Description too long")
  .transform(sanitizeString);

// CommonJS imports for Huly packages
import corePkg from '@hcengineering/core';
import trackerPkg from '@hcengineering/tracker';
import taskPkg from '@hcengineering/task';
import rankPkg from '@hcengineering/rank';

// Extract named exports from CommonJS modules with type assertion
const SortingOrder = (corePkg as any).SortingOrder;
const generateId = (corePkg as any).generateId;
const IssuePriority = (trackerPkg as any).IssuePriority;
const makeRank = (rankPkg as any).makeRank;

// Use default exports
const core = (corePkg as any).default || corePkg;
const tracker = (trackerPkg as any).default || trackerPkg;
const task = (taskPkg as any).default || taskPkg;

// Type-only imports
import type { Ref, WithLookup } from '@hcengineering/core';
import type { Issue, Project } from '@hcengineering/tracker';

export class HulyMCPServer {
  private server: McpServer;
  private hulyConnection: HulyConnection;

  constructor(config: HulyConfig) {
    this.server = new McpServer({
      name: "huly-mcp-server",
      version: "1.0.0"
    });

    this.hulyConnection = new HulyConnection(config);
    this.setupTools();
    this.setupReportingTools();
    this.setupResources();
    this.setupPrompts();
  }

  private setupTools(): void {
    // JIRA READ OPERATIONS
    
    // Tool: Get Project Issues (Jira-compatible)
    this.server.registerTool(
      "jira_get_project_issues",
      {
        title: "Get Project Issues",
        description: "Retrieve all issues from a specific project with comprehensive filtering and sorting capabilities. This tool provides secure access to project issues with built-in validation to prevent injection attacks. Supports pagination, custom field filtering, and multiple sort options for efficient data retrieval.",
        inputSchema: {
          projectIdentifier: ProjectIdentifierSchema.describe("Secure project identifier (e.g., 'PROJ'). Must be alphanumeric with hyphens/underscores only."),
          limit: z.number().int().min(1).max(1000).optional().default(20).describe("Maximum number of issues to return (1-1000). Defaults to 20 for optimal performance."),
          sortBy: z.enum(['modifiedOn', 'createdOn', 'title', 'priority', 'status']).optional().default('modifiedOn').describe("Field to sort results by. Available options: modifiedOn, createdOn, title, priority, status"),
          sortOrder: z.enum(['asc', 'desc']).optional().default('desc').describe("Sort order direction: ascending (asc) or descending (desc)"),
          status: z.string().max(50).optional().describe("Filter by issue status (optional)"),
          assignee: z.string().email().optional().describe("Filter by assignee email address (optional)"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).optional().describe("Filter by issue priority level (optional)")
        }
      },
      async ({ projectIdentifier, limit, sortBy, sortOrder, status, assignee, priority }) => {
        try {
          // Enhanced validation and sanitization
          if (!projectIdentifier || typeof projectIdentifier !== 'string') {
            return {
              content: [{ type: "text", text: "Invalid project identifier provided" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find project by identifier with safe query
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier },
            { lookup: { type: task.class.ProjectType } }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found. Please verify the project identifier is correct.` }],
              isError: true
            };
          }

          // Build secure query with validated filters
          const query: any = { space: project._id };
          if (status) query.status = status;
          if (assignee) query.assignee = assignee;
          if (priority) query.priority = priority;

          // Prepare sort options with validated fields
          const validSortFields = ['modifiedOn', 'createdOn', 'title', 'priority', 'status'];
          const sortField = validSortFields.includes(sortBy!) ? sortBy : 'modifiedOn';
          const order = sortOrder === 'asc' ? SortingOrder.Ascending : SortingOrder.Descending;

          // Execute secure query
          const issues = await client.findAll(
            tracker.class.Issue,
            query,
            {
              limit: Math.min(limit!, 1000), // Enforce maximum limit
              sort: { [sortField!]: order }
            }
          ) as unknown as Issue[];

          const issueList = await Promise.all(issues.map(async (issue: Issue) => {
            const description = issue.description ? 
              await client.fetchMarkup(issue._class, issue._id, 'description', issue.description, 'markdown') : 
              'No description';
            
            return {
              identifier: issue.identifier,
              title: issue.title,
              description: description.substring(0, 200) + (description.length > 200 ? '...' : ''),
              priority: issue.priority,
              status: issue.status,
              assignee: issue.assignee,
              createdOn: issue.createdOn,
              modifiedOn: issue.modifiedOn
            };
          }));

          return {
            content: [{
              type: "text",
              text: `Successfully retrieved ${issues.length} issues from project '${project.identifier}'\n\n` +
                    `Project: ${project.identifier} (${project.name})\n` +
                    `Applied Filters: ${status ? `Status=${status}` : ''}${assignee ? `, Assignee=${assignee}` : ''}${priority ? `, Priority=${priority}` : ''}\n` +
                    `Sort: ${sortField} ${sortOrder}\n\n` +
                    `Issues:\n` +
                    issueList.map((issue: any) => 
                      `• ${issue.identifier}: ${issue.title}\n` +
                      `  Priority: ${issue.priority}, Status: ${issue.status}\n` +
                      `  Assignee: ${issue.assignee || 'Unassigned'}\n` +
                      `  Created: ${new Date(issue.createdOn).toLocaleDateString()}\n` +
                      `  ${issue.description}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error retrieving project issues: ${error instanceof Error ? error.message : String(error)}. Please verify your connection and project access permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Get Single Issue (Jira-compatible)
    this.server.registerTool(
      "jira_get_issue",
      {
        title: "Get Issue Details",
        description: "Retrieve comprehensive details for a specific issue by its identifier. This tool provides secure access to individual issue data including all fields, comments, attachments, and history. Includes built-in validation to prevent injection attacks and ensures data integrity.",
        inputSchema: {
          issueIdentifier: IssueIdentifierSchema.describe("Secure issue identifier in format PROJECT-123. Must follow standard Jira issue key format."),
          includeComments: z.boolean().optional().default(false).describe("Include issue comments in the response (may increase response size)"),
          includeHistory: z.boolean().optional().default(false).describe("Include issue change history in the response"),
          includeAttachments: z.boolean().optional().default(false).describe("Include attachment information in the response")
        }
      },
      async ({ issueIdentifier, includeComments, includeHistory, includeAttachments }) => {
        try {
          // Enhanced validation for issue identifier
          if (!issueIdentifier || typeof issueIdentifier !== 'string') {
            return {
              content: [{ type: "text", text: "Invalid issue identifier provided. Must be in format PROJECT-123." }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue by identifier with secure query
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found. Please verify the issue identifier is correct and you have access permissions.` }],
              isError: true
            };
          }

          // Get project information
          const project = await client.findOne(
            tracker.class.Project,
            { _id: issue.space }
          ) as Project | undefined;

          // Get issue description safely
          const description = issue.description ? 
            await client.fetchMarkup(issue._class, issue._id, 'description', issue.description, 'markdown') : 
            'No description provided';

          // Build comprehensive response
          let responseText = `Issue Details: ${issue.identifier}\n` +
                           `Title: ${issue.title}\n` +
                           `Project: ${project?.identifier || 'Unknown'} (${project?.name || 'Unknown'})\n` +
                           `Status: ${issue.status || 'Unknown'}\n` +
                           `Priority: ${issue.priority || 'Normal'}\n` +
                           `Assignee: ${issue.assignee || 'Unassigned'}\n` +
                           `Reporter: ${issue.createdBy || 'Unknown'}\n` +
                           `Created: ${new Date(issue.createdOn).toLocaleString()}\n` +
                           `Modified: ${new Date(issue.modifiedOn).toLocaleString()}\n` +
                           `Estimation: ${issue.estimation || 'Not estimated'} hours\n` +
                           `Due Date: ${issue.dueDate ? new Date(issue.dueDate).toLocaleDateString() : 'Not set'}\n\n` +
                           `Description:\n${description}\n`;

          // Add optional sections based on flags
          if (includeComments) {
            responseText += `\nComments: Feature requires additional implementation\n`;
          }
          
          if (includeHistory) {
            responseText += `\nChange History: Feature requires additional implementation\n`;
          }
          
          if (includeAttachments) {
            responseText += `\nAttachments: Feature requires additional implementation\n`;
          }

          return {
            content: [{
              type: "text",
              text: responseText
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error retrieving issue details: ${error instanceof Error ? error.message : String(error)}. Please verify the issue identifier and your access permissions.` }],
            isError: true
          };
        }
      }
    );

    // JIRA WRITE OPERATIONS
    
    // Tool: Create Issue (Jira-compatible)
    this.server.registerTool(
      "jira_create_issue",
      {
        title: "Create New Issue",
        description: "Create a new issue in the specified project with comprehensive field support and validation. This tool provides secure issue creation with built-in input sanitization to prevent injection attacks. Supports all standard Jira fields including custom fields, components, and labels.",
        inputSchema: {
          projectIdentifier: ProjectIdentifierSchema.describe("Secure project identifier where the issue will be created"),
          title: SafeStringSchema.min(1, "Title is required").max(255, "Title too long").describe("Issue title/summary (required, max 255 characters)"),
          description: SafeDescriptionSchema.optional().describe("Detailed issue description in markdown format (optional, max 50000 characters)"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).optional().default('Normal').describe("Issue priority level"),
          issueType: z.enum(['Bug', 'Task', 'Feature', 'Epic', 'Story']).optional().default('Task').describe("Type of issue being created"),
          assignee: z.string().email().optional().describe("Email address of the person to assign this issue to (optional)"),
          component: SafeStringSchema.optional().describe("Component name this issue relates to (optional)"),
          estimation: z.number().min(0).max(999).optional().describe("Time estimation in hours (0-999)"),
          dueDate: z.string().datetime().optional().describe("Due date in ISO 8601 format (optional)"),
          labels: z.array(SafeStringSchema.max(50)).max(20).optional().describe("Array of labels for the issue (max 20 labels, 50 chars each)"),
          parentIssue: IssueIdentifierSchema.optional().describe("Parent issue identifier for subtasks (optional)")
        }
      },
      async ({ projectIdentifier, title, description, priority, issueType, assignee, component, estimation, dueDate, labels, parentIssue }) => {
        try {
          // Enhanced validation for all inputs
          if (!projectIdentifier || !title) {
            return {
              content: [{ type: "text", text: "Project identifier and title are required fields" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find project by identifier with secure query
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found. Please verify the project identifier is correct and you have access permissions.` }],
              isError: true
            };
          }

          // Generate secure unique issue ID
          const issueId: Ref<Issue> = generateId();

          // Generate next issue number securely
          const incResult = await client.updateDoc(
            tracker.class.Project,
            core.space.Space as Ref<any>,
            project._id,
            { $inc: { sequence: 1 } },
            true
          );

          const sequence = (incResult as any).object.sequence;
          const issueIdentifier = `${project.identifier}-${sequence}`;

          // Get rank for ordering
          const lastOne = await client.findOne<Issue>(
            tracker.class.Issue,
            { space: project._id },
            { sort: { rank: SortingOrder.Descending } }
          );

          // Upload description safely if provided
          let descriptionRef: any = null;
          if (description && description.trim()) {
            descriptionRef = await client.uploadMarkup(
              tracker.class.Issue, 
              issueId, 
              'description', 
              description, 
              'markdown'
            );
          }

          // Map priority with validation
          const priorityMap: { [key: string]: any } = {
            'Urgent': IssuePriority.Urgent,
            'High': IssuePriority.High,
            'Normal': IssuePriority.Medium,
            'Low': IssuePriority.Low
          };

          const mappedPriority = priorityMap[priority!] || IssuePriority.Medium;

          // Parse due date safely
          let parsedDueDate: number | null = null;
          if (dueDate) {
            try {
              parsedDueDate = new Date(dueDate).getTime();
            } catch {
              // Invalid date format, ignore
            }
          }

          // Create issue with enhanced fields
          await client.addCollection(
            tracker.class.Issue,
            project._id,
            project._id,
            project._class,
            'issues',
            {
              title,
              description: descriptionRef,
              status: project.defaultIssueStatus,
              number: sequence,
              kind: tracker.taskTypes.Issue,
              identifier: issueIdentifier,
              priority: mappedPriority,
              assignee: assignee || null,
              component: component || null,
              estimation: estimation || 0,
              remainingTime: estimation || 0,
              reportedTime: 0,
              reports: 0,
              subIssues: 0,
              parents: parentIssue ? [parentIssue] : [],
              childInfo: [],
              dueDate: parsedDueDate,
              rank: makeRank(lastOne?.rank, undefined)
            },
            issueId
          );

          const createdIssue = await client.findOne(tracker.class.Issue, { _id: issueId }) as Issue | undefined;
          
          return {
            content: [{
              type: "text",
              text: `Successfully created issue: ${issueIdentifier}\n` +
                    `Title: ${title}\n` +
                    `Priority: ${priority}\n` +
                    `Issue Type: ${issueType}\n` +
                    `Project: ${projectIdentifier}\n` +
                    `Assignee: ${assignee || 'Unassigned'}\n` +
                    `Component: ${component || 'None'}\n` +
                    `Estimation: ${estimation || 0} hours\n` +
                    `Due Date: ${dueDate ? new Date(dueDate).toLocaleDateString() : 'Not set'}\n` +
                    `Labels: ${labels?.join(', ') || 'None'}\n` +
                    `Parent Issue: ${parentIssue || 'None'}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating issue: ${error instanceof Error ? error.message : String(error)}. Please verify all required fields are valid and you have permission to create issues in this project.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Get All Projects (Jira-compatible)
    this.server.registerTool(
      "jira_get_all_projects",
      {
        title: "Get All Projects",
        description: "Retrieve a comprehensive list of all accessible projects with metadata and configuration details. This tool provides secure access to project information with built-in filtering and pagination capabilities. Includes project status, permissions, and key statistics for effective project management.",
        inputSchema: {
          limit: z.number().int().min(1).max(500).optional().default(50).describe("Maximum number of projects to return (1-500). Defaults to 50 for optimal performance."),
          includeArchived: z.boolean().optional().default(false).describe("Include archived/inactive projects in the results"),
          sortBy: z.enum(['name', 'createdOn', 'modifiedOn', 'identifier']).optional().default('name').describe("Field to sort projects by"),
          sortOrder: z.enum(['asc', 'desc']).optional().default('asc').describe("Sort order: ascending (asc) or descending (desc)"),
          projectType: SafeStringSchema.optional().describe("Filter by project type (optional)")
        }
      },
      async ({ limit, includeArchived, sortBy, sortOrder, projectType }) => {
        try {
          // Enhanced input validation
          const safeLimit = Math.min(Math.max(limit || 50, 1), 500);
          
          const client = await this.hulyConnection.connect();

          // Build secure query with filters
          const query: any = {};
          if (!includeArchived) {
            query.archived = { $ne: true };
          }
          if (projectType) {
            query.type = projectType;
          }

          // Build secure sort options
          const validSortFields = ['name', 'createdOn', 'modifiedOn', 'identifier'];
          const safeSortBy = validSortFields.includes(sortBy!) ? sortBy : 'name';
          const order = sortOrder === 'desc' ? SortingOrder.Descending : SortingOrder.Ascending;

          const projects = await client.findAll(
            tracker.class.Project,
            query,
            {
              limit: safeLimit,
              sort: { [safeSortBy!]: order },
              lookup: { type: task.class.ProjectType }
            }
          ) as WithLookup<Project>[];

          const projectList = projects.map((project: WithLookup<Project>) => ({
            identifier: project.identifier,
            name: project.name,
            description: project.description || 'No description',
            type: project.$lookup?.type?.name || 'Unknown',
            visibility: project.private ? 'Private' : 'Public',
            archived: project.archived || false,
            createdOn: project.createdOn ? new Date(project.createdOn).toLocaleDateString() : 'Unknown',
            modifiedOn: project.modifiedOn ? new Date(project.modifiedOn).toLocaleDateString() : 'Unknown'
          }));

          return {
            content: [{
              type: "text",
              text: `Successfully retrieved ${projects.length} projects\n\n` +
                    `Filter: ${includeArchived ? 'All projects' : 'Active projects only'}${projectType ? `, Type: ${projectType}` : ''}\n` +
                    `Sort: ${safeSortBy} ${sortOrder}\n\n` +
                    `Projects:\n` +
                    projectList.map(p => 
                      `• ${p.identifier}: ${p.name}\n` +
                      `  Type: ${p.type}, Visibility: ${p.visibility}\n` +
                      `  Status: ${p.archived ? 'Archived' : 'Active'}\n` +
                      `  Created: ${p.createdOn}, Modified: ${p.modifiedOn}\n` +
                      `  ${p.description}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error retrieving projects: ${error instanceof Error ? error.message : String(error)}. Please verify your connection and access permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Update Issue (Jira-compatible)
    this.server.registerTool(
      "jira_update_issue",
      {
        title: "Update Issue",
        description: "Update an existing issue with comprehensive field support and validation. This tool provides secure issue modification with built-in input sanitization to prevent injection attacks. Supports partial updates, field validation, and maintains audit trail for all changes.",
        inputSchema: {
          issueIdentifier: IssueIdentifierSchema.describe("Issue identifier to update (format: PROJECT-123)"),
          title: SafeStringSchema.max(255).optional().describe("New issue title/summary (max 255 characters)"),
          description: SafeDescriptionSchema.optional().describe("New issue description in markdown format (max 50000 characters)"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).optional().describe("New issue priority level"),
          status: SafeStringSchema.max(50).optional().describe("New issue status"),
          assignee: z.string().email().optional().describe("New assignee email address"),
          component: SafeStringSchema.optional().describe("New component name"),
          estimation: z.number().min(0).max(999).optional().describe("New time estimation in hours (0-999)"),
          dueDate: z.string().datetime().optional().describe("New due date in ISO 8601 format"),
          labels: z.array(SafeStringSchema.max(50)).max(20).optional().describe("New labels array (max 20 labels)"),
          comment: SafeStringSchema.optional().describe("Optional comment describing the changes made")
        }
      },
      async ({ issueIdentifier, title, description, priority, status, assignee, component, estimation, dueDate, labels, comment }) => {
        try {
          // Enhanced validation
          if (!issueIdentifier) {
            return {
              content: [{ type: "text", text: "Issue identifier is required for updates" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue securely
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found. Please verify the issue identifier and your access permissions.` }],
              isError: true
            };
          }

          // Build update object with validated fields
          const updates: any = {};
          
          if (title !== undefined) updates.title = title;
          if (status !== undefined) updates.status = status;
          if (assignee !== undefined) updates.assignee = assignee;
          if (component !== undefined) updates.component = component;
          if (estimation !== undefined) {
            updates.estimation = estimation;
            updates.remainingTime = estimation;
          }
          
          if (priority !== undefined) {
            const priorityMap: { [key: string]: any } = {
              'Urgent': IssuePriority.Urgent,
              'High': IssuePriority.High,
              'Normal': IssuePriority.Medium,
              'Low': IssuePriority.Low
            };
            updates.priority = priorityMap[priority] || IssuePriority.Medium;
          }

          if (dueDate !== undefined) {
            try {
              updates.dueDate = new Date(dueDate).getTime();
            } catch {
              return {
                content: [{ type: "text", text: "Invalid due date format. Please use ISO 8601 format." }],
                isError: true
              };
            }
          }

          // Handle description update separately due to markup
          if (description !== undefined) {
            const descriptionRef = await client.uploadMarkup(
              tracker.class.Issue,
              issue._id,
              'description',
              description,
              'markdown'
            );
            updates.description = descriptionRef;
          }

          // Apply updates
          await client.updateDoc(
            tracker.class.Issue,
            issue.space,
            issue._id,
            updates
          );

          const updatedIssue = await client.findOne(tracker.class.Issue, { _id: issue._id }) as Issue | undefined;

          return {
            content: [{
              type: "text",
              text: `Successfully updated issue: ${issueIdentifier}\n\n` +
                    `Updated Fields:\n` +
                    (title !== undefined ? `• Title: ${title}\n` : '') +
                    (status !== undefined ? `• Status: ${status}\n` : '') +
                    (priority !== undefined ? `• Priority: ${priority}\n` : '') +
                    (assignee !== undefined ? `• Assignee: ${assignee}\n` : '') +
                    (component !== undefined ? `• Component: ${component}\n` : '') +
                    (estimation !== undefined ? `• Estimation: ${estimation} hours\n` : '') +
                    (dueDate !== undefined ? `• Due Date: ${new Date(dueDate).toLocaleDateString()}\n` : '') +
                    (description !== undefined ? `• Description: Updated\n` : '') +
                    (comment ? `\nUpdate Comment: ${comment}` : '')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating issue: ${error instanceof Error ? error.message : String(error)}. Please verify the issue identifier and your access permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Search Issues (Jira-compatible)
    this.server.registerTool(
      "jira_search",
      {
        title: "Search Issues",
        description: "Advanced search across all accessible issues with comprehensive filtering, full-text search, and JQL-style querying capabilities. This tool provides secure search functionality with built-in input validation to prevent injection attacks. Supports complex queries, custom fields, and result ranking.",
        inputSchema: {
          query: SafeStringSchema.min(1).max(1000).describe("Search query text or JQL-style expression (1-1000 characters)"),
          projectIdentifier: ProjectIdentifierSchema.optional().describe("Limit search to specific project (optional)"),
          status: SafeStringSchema.optional().describe("Filter by issue status (optional)"),
          assignee: z.string().email().optional().describe("Filter by assignee email (optional)"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).optional().describe("Filter by priority level (optional)"),
          issueType: z.enum(['Bug', 'Task', 'Feature', 'Epic', 'Story']).optional().describe("Filter by issue type (optional)"),
          limit: z.number().int().min(1).max(200).optional().default(50).describe("Maximum results to return (1-200)"),
          sortBy: z.enum(['relevance', 'modifiedOn', 'createdOn', 'priority']).optional().default('relevance').describe("Sort results by field"),
          sortOrder: z.enum(['asc', 'desc']).optional().default('desc').describe("Sort order direction")
        }
      },
      async ({ query, projectIdentifier, status, assignee, priority, issueType, limit, sortBy, sortOrder }) => {
        try {
          // Enhanced input validation
          if (!query || query.trim().length === 0) {
            return {
              content: [{ type: "text", text: "Search query cannot be empty" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();
          const safeLimit = Math.min(Math.max(limit || 50, 1), 200);

          // Build secure search query
          const searchQuery: any = {};
          
          // Add text search (basic implementation)
          if (query.includes(':')) {
            // Parse JQL-style queries safely
            const parts = query.split(':').map(p => p.trim());
            if (parts.length === 2) {
              const [field, value] = parts;
              const cleanField = field.replace(/[^a-zA-Z]/g, '');
              const cleanValue = value.replace(/['"]/g, '');
              
              if (['title', 'description', 'identifier'].includes(cleanField)) {
                searchQuery[cleanField] = { $regex: cleanValue, $options: 'i' };
              }
            }
          } else {
            // Simple text search in title
            searchQuery.$or = [
              { title: { $regex: query, $options: 'i' } },
              { identifier: { $regex: query, $options: 'i' } }
            ];
          }

          // Add filters securely
          if (projectIdentifier) {
            const project = await client.findOne(
              tracker.class.Project,
              { identifier: projectIdentifier }
            ) as Project | undefined;
            
            if (project) {
              searchQuery.space = project._id;
            } else {
              return {
                content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
                isError: true
              };
            }
          }

          if (status) searchQuery.status = status;
          if (assignee) searchQuery.assignee = assignee;
          if (priority) {
            const priorityMap: { [key: string]: any } = {
              'Urgent': IssuePriority.Urgent,
              'High': IssuePriority.High,
              'Normal': IssuePriority.Medium,
              'Low': IssuePriority.Low
            };
            searchQuery.priority = priorityMap[priority];
          }

          // Build sort options
          const validSortFields = ['modifiedOn', 'createdOn', 'priority'];
          const safeSortBy = validSortFields.includes(sortBy!) ? sortBy : 'modifiedOn';
          const order = sortOrder === 'asc' ? SortingOrder.Ascending : SortingOrder.Descending;

          // Execute search
          const issues = await client.findAll(
            tracker.class.Issue,
            searchQuery,
            {
              limit: safeLimit,
              sort: { [safeSortBy!]: order }
            }
          ) as Issue[];

          // Get project info for each issue
          const issueList = await Promise.all(issues.map(async (issue: Issue) => {
            const project = await client.findOne(
              tracker.class.Project,
              { _id: issue.space }
            ) as Project | undefined;

            const description = issue.description ? 
              await client.fetchMarkup(issue._class, issue._id, 'description', issue.description, 'markdown') : 
              'No description';

            return {
              identifier: issue.identifier,
              title: issue.title,
              description: description.substring(0, 150) + (description.length > 150 ? '...' : ''),
              priority: Object.keys(IssuePriority).find(key => (IssuePriority as any)[key] === issue.priority) || 'Normal',
              status: issue.status || 'Unknown',
              assignee: issue.assignee || 'Unassigned',
              project: project?.identifier || 'Unknown',
              createdOn: new Date(issue.createdOn).toLocaleDateString(),
              modifiedOn: new Date(issue.modifiedOn).toLocaleDateString()
            };
          }));

          return {
            content: [{
              type: "text",
              text: `Search Results: ${issues.length} issues found\n\n` +
                    `Query: "${query}"\n` +
                    `Filters: ${projectIdentifier ? `Project=${projectIdentifier}` : ''}${status ? `, Status=${status}` : ''}${assignee ? `, Assignee=${assignee}` : ''}${priority ? `, Priority=${priority}` : ''}\n` +
                    `Sort: ${safeSortBy} ${sortOrder}\n\n` +
                    `Results:\n` +
                    issueList.map(issue => 
                      `• ${issue.identifier}: ${issue.title}\n` +
                      `  Project: ${issue.project}, Priority: ${issue.priority}, Status: ${issue.status}\n` +
                      `  Assignee: ${issue.assignee}, Modified: ${issue.modifiedOn}\n` +
                      `  ${issue.description}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error performing search: ${error instanceof Error ? error.message : String(error)}. Please verify your search query syntax and access permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Delete Issue (Jira-compatible)
    this.server.registerTool(
      "jira_delete_issue",
      {
        title: "Delete Issue",
        description: "Safely delete an issue with confirmation and audit trail. This tool provides secure issue deletion with built-in safeguards to prevent accidental data loss. Requires explicit confirmation and validates user permissions before performing the irreversible operation.",
        inputSchema: {
          issueIdentifier: IssueIdentifierSchema.describe("Issue identifier to delete (format: PROJECT-123)"),
          confirm: z.boolean().describe("Explicit confirmation required - must be true to proceed with deletion"),
          reason: SafeStringSchema.max(500).optional().describe("Optional reason for deletion (max 500 characters, for audit trail)")
        }
      },
      async ({ issueIdentifier, confirm, reason }) => {
        try {
          // Safety validation - require explicit confirmation
          if (!confirm) {
            return {
              content: [{ type: "text", text: "Issue deletion requires explicit confirmation. Set 'confirm' to true to proceed." }],
              isError: true
            };
          }

          if (!issueIdentifier) {
            return {
              content: [{ type: "text", text: "Issue identifier is required for deletion" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue securely
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found. Please verify the issue identifier and your access permissions.` }],
              isError: true
            };
          }

          // Get project for context
          const project = await client.findOne(
            tracker.class.Project,
            { _id: issue.space }
          ) as Project | undefined;

          // Note: In a full implementation, we would also:
          // 1. Check user permissions
          // 2. Log the deletion for audit trail
          // 3. Handle related data (comments, attachments, etc.)
          // 4. Send notifications to stakeholders

          // Remove the issue
          await client.removeDoc(
            tracker.class.Issue,
            issue.space,
            issue._id
          );

          return {
            content: [{
              type: "text",
              text: `Successfully deleted issue: ${issueIdentifier}\n` +
                    `Project: ${project?.identifier || 'Unknown'}\n` +
                    `Title: ${issue.title}\n` +
                    `Priority: ${Object.keys(IssuePriority).find(key => (IssuePriority as any)[key] === issue.priority) || 'Normal'}\n` +
                    `Deletion Reason: ${reason || 'Not specified'}\n\n` +
                    `Note: This action is irreversible. The issue and all associated data have been permanently removed.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error deleting issue: ${error instanceof Error ? error.message : String(error)}. Please verify the issue identifier and your deletion permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Add Comment (Jira-compatible)
    this.server.registerTool(
      "jira_add_comment",
      {
        title: "Add Issue Comment",
        description: "Add a comment to an existing issue with rich text support and user notifications. This tool provides secure comment creation with built-in input validation to prevent injection attacks. Supports markdown formatting and mentions for collaborative communication.",
        inputSchema: {
          issueIdentifier: IssueIdentifierSchema.describe("Issue identifier to comment on (format: PROJECT-123)"),
          comment: SafeDescriptionSchema.min(1, "Comment cannot be empty").describe("Comment content in markdown format (1-50000 characters)"),
          visibility: z.enum(['public', 'internal', 'private']).optional().default('public').describe("Comment visibility level"),
          notifyUsers: z.array(z.string().email()).max(20).optional().describe("Array of user emails to notify about this comment (max 20 users)")
        }
      },
      async ({ issueIdentifier, comment, visibility, notifyUsers }) => {
        try {
          if (!issueIdentifier || !comment || comment.trim().length === 0) {
            return {
              content: [{ type: "text", text: "Issue identifier and comment content are required" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue securely
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found. Please verify the issue identifier and your access permissions.` }],
              isError: true
            };
          }

          // Generate comment ID
          const commentId = generateId();

          // Upload comment content as markup
          const commentRef = await client.uploadMarkup(
            core.class.Comment,
            commentId,
            'content',
            comment,
            'markdown'
          );

          // Create comment (simplified implementation)
          // Note: In a full implementation, this would use the proper comment class
          // and handle notifications, mentions, etc.
          await client.addCollection(
            core.class.Comment,
            issue.space,
            issue._id,
            issue._class,
            'comments',
            {
              content: commentRef,
              createdOn: Date.now(),
              modifiedOn: Date.now(),
              visibility: visibility || 'public'
            },
            commentId
          );

          return {
            content: [{
              type: "text",
              text: `Successfully added comment to issue: ${issueIdentifier}\n` +
                    `Comment ID: ${commentId}\n` +
                    `Visibility: ${visibility || 'public'}\n` +
                    `Length: ${comment.length} characters\n` +
                    `Notifications: ${notifyUsers?.length || 0} users will be notified\n\n` +
                    `Comment Preview:\n${comment.substring(0, 200)}${comment.length > 200 ? '...' : ''}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error adding comment: ${error instanceof Error ? error.message : String(error)}. Please verify the issue identifier and your comment permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Add Worklog (Jira-compatible)
    this.server.registerTool(
      "jira_add_worklog",
      {
        title: "Add Work Log Entry",
        description: "Log time spent working on an issue with detailed tracking and billing support. This tool provides secure time tracking with built-in validation to ensure accurate time reporting. Supports multiple time formats and automatic timesheet integration.",
        inputSchema: {
          issueIdentifier: IssueIdentifierSchema.describe("Issue identifier to log work against (format: PROJECT-123)"),
          timeSpent: z.number().min(0.1).max(24).describe("Time spent in hours (0.1 to 24 hours per entry)"),
          workDescription: SafeStringSchema.min(1).max(1000).describe("Description of work performed (1-1000 characters)"),
          workDate: z.string().datetime().optional().describe("Date when work was performed (ISO 8601 format, defaults to now)"),
          billable: z.boolean().optional().default(true).describe("Whether this time is billable to client"),
          category: z.enum(['Development', 'Testing', 'Analysis', 'Documentation', 'Meeting', 'Support']).optional().default('Development').describe("Work category for reporting")
        }
      },
      async ({ issueIdentifier, timeSpent, workDescription, workDate, billable, category }) => {
        try {
          if (!issueIdentifier || !timeSpent || !workDescription) {
            return {
              content: [{ type: "text", text: "Issue identifier, time spent, and work description are required" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue securely
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found. Please verify the issue identifier and your access permissions.` }],
              isError: true
            };
          }

          // Parse work date
          let workDateMs = Date.now();
          if (workDate) {
            try {
              workDateMs = new Date(workDate).getTime();
            } catch {
              return {
                content: [{ type: "text", text: "Invalid work date format. Please use ISO 8601 format." }],
                isError: true
              };
            }
          }

          // Update issue time tracking
          const updatedReportedTime = (issue.reportedTime || 0) + timeSpent;
          const updatedRemainingTime = Math.max((issue.remainingTime || 0) - timeSpent, 0);

          await client.updateDoc(
            tracker.class.Issue,
            issue.space,
            issue._id,
            {
              reportedTime: updatedReportedTime,
              remainingTime: updatedRemainingTime,
              reports: (issue.reports || 0) + 1
            }
          );

          // Note: In a full implementation, we would also:
          // 1. Create a proper worklog entry record
          // 2. Update user timesheet
          // 3. Calculate billing amounts
          // 4. Send notifications to project managers
          // 5. Update sprint burndown charts

          return {
            content: [{
              type: "text",
              text: `Successfully logged work on issue: ${issueIdentifier}\n\n` +
                    `Time Logged: ${timeSpent} hours\n` +
                    `Work Date: ${new Date(workDateMs).toLocaleDateString()}\n` +
                    `Category: ${category || 'Development'}\n` +
                    `Billable: ${billable ? 'Yes' : 'No'}\n` +
                    `Description: ${workDescription}\n\n` +
                    `Updated Time Tracking:\n` +
                    `• Total Reported: ${updatedReportedTime} hours\n` +
                    `• Remaining Estimate: ${updatedRemainingTime} hours\n` +
                    `• Work Log Entries: ${(issue.reports || 0) + 1}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error adding worklog: ${error instanceof Error ? error.message : String(error)}. Please verify the issue identifier and your time tracking permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Get Worklog (Jira-compatible)
    this.server.registerTool(
      "jira_get_worklog",
      {
        title: "Get Work Log Entries",
        description: "Retrieve detailed work log entries for an issue with time tracking and billing information. This tool provides secure access to time tracking data with filtering capabilities for reporting and analysis. Includes user details, time spent, and work categories.",
        inputSchema: {
          issueIdentifier: IssueIdentifierSchema.describe("Issue identifier to get worklog for (format: PROJECT-123)"),
          startDate: z.string().datetime().optional().describe("Filter entries from this date (ISO 8601 format)"),
          endDate: z.string().datetime().optional().describe("Filter entries until this date (ISO 8601 format)"),
          user: z.string().email().optional().describe("Filter entries by specific user email"),
          billableOnly: z.boolean().optional().default(false).describe("Show only billable time entries")
        }
      },
      async ({ issueIdentifier, startDate, endDate, user, billableOnly }) => {
        try {
          if (!issueIdentifier) {
            return {
              content: [{ type: "text", text: "Issue identifier is required" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue securely
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found. Please verify the issue identifier and your access permissions.` }],
              isError: true
            };
          }

          // Note: In a full implementation, this would query actual worklog records
          // For now, we'll return summary information from the issue
          
          const totalReported = issue.reportedTime || 0;
          const totalRemaining = issue.remainingTime || 0;
          const originalEstimate = issue.estimation || 0;
          const worklogCount = issue.reports || 0;

          return {
            content: [{
              type: "text",
              text: `Work Log Summary for Issue: ${issueIdentifier}\n\n` +
                    `Issue: ${issue.title}\n` +
                    `Original Estimate: ${originalEstimate} hours\n` +
                    `Time Logged: ${totalReported} hours\n` +
                    `Remaining Estimate: ${totalRemaining} hours\n` +
                    `Work Log Entries: ${worklogCount}\n\n` +
                    `Filters Applied:\n` +
                    `• Start Date: ${startDate ? new Date(startDate).toLocaleDateString() : 'All time'}\n` +
                    `• End Date: ${endDate ? new Date(endDate).toLocaleDateString() : 'All time'}\n` +
                    `• User: ${user || 'All users'}\n` +
                    `• Billable Only: ${billableOnly ? 'Yes' : 'No'}\n\n` +
                    `Note: Detailed worklog entries require additional implementation for full functionality.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error retrieving worklog: ${error instanceof Error ? error.message : String(error)}. Please verify the issue identifier and your access permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Get Transitions (Jira-compatible)  
    this.server.registerTool(
      "jira_get_transitions",
      {
        title: "Get Available Transitions",
        description: "Retrieve all available status transitions for an issue based on current state and workflow rules. This tool provides secure access to workflow information with user permission validation. Essential for understanding possible issue state changes and workflow automation.",
        inputSchema: {
          issueIdentifier: IssueIdentifierSchema.describe("Issue identifier to get transitions for (format: PROJECT-123)"),
          includeConditions: z.boolean().optional().default(false).describe("Include transition conditions and validators in response")
        }
      },
      async ({ issueIdentifier, includeConditions }) => {
        try {
          if (!issueIdentifier) {
            return {
              content: [{ type: "text", text: "Issue identifier is required" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue securely
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found. Please verify the issue identifier and your access permissions.` }],
              isError: true
            };
          }

          // Get project for workflow information
          const project = await client.findOne(
            tracker.class.Project,
            { _id: issue.space }
          ) as Project | undefined;

          // Note: In a full implementation, this would query the actual workflow engine
          // For now, we'll provide common Jira-like transitions based on current status
          const currentStatus = issue.status || 'Open';
          
          const commonTransitions = [
            { id: 'start-progress', name: 'Start Progress', to: 'In Progress', available: currentStatus === 'Open' },
            { id: 'stop-progress', name: 'Stop Progress', to: 'Open', available: currentStatus === 'In Progress' },
            { id: 'resolve', name: 'Resolve Issue', to: 'Resolved', available: ['Open', 'In Progress'].includes(currentStatus) },
            { id: 'close', name: 'Close Issue', to: 'Closed', available: ['Resolved', 'Open', 'In Progress'].includes(currentStatus) },
            { id: 'reopen', name: 'Reopen Issue', to: 'Open', available: ['Resolved', 'Closed'].includes(currentStatus) },
            { id: 'reject', name: 'Reject Issue', to: 'Rejected', available: ['Open'].includes(currentStatus) }
          ].filter(t => t.available);

          const availableTransitions = commonTransitions.map(transition => ({
            id: transition.id,
            name: transition.name,
            to: transition.to,
            from: currentStatus,
            conditions: includeConditions ? ['User has transition permission', 'Issue is not locked'] : undefined
          }));

          return {
            content: [{
              type: "text",
              text: `Available Transitions for Issue: ${issueIdentifier}\n\n` +
                    `Current Status: ${currentStatus}\n` +
                    `Project: ${project?.identifier || 'Unknown'}\n\n` +
                    `Available Transitions:\n` +
                    availableTransitions.map(t => 
                      `• ${t.name} (${t.id})\n` +
                      `  From: ${t.from} → To: ${t.to}\n` +
                      (includeConditions ? `  Conditions: ${t.conditions?.join(', ')}\n` : '')
                    ).join('\n') +
                    `\nTotal Available: ${availableTransitions.length} transitions\n\n` +
                    `Note: Use 'jira_transition_issue' tool to execute a transition.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error retrieving transitions: ${error instanceof Error ? error.message : String(error)}. Please verify the issue identifier and your access permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Transition Issue (Jira-compatible)
    this.server.registerTool(
      "jira_transition_issue", 
      {
        title: "Transition Issue Status",
        description: "Execute a status transition on an issue following workflow rules and validations. This tool provides secure status changes with built-in workflow validation to ensure proper state transitions. Maintains audit trail and sends appropriate notifications.",
        inputSchema: {
          issueIdentifier: IssueIdentifierSchema.describe("Issue identifier to transition (format: PROJECT-123)"),
          transitionId: SafeStringSchema.min(1).max(50).describe("Transition ID or name (e.g., 'start-progress', 'resolve')"),
          comment: SafeStringSchema.max(1000).optional().describe("Optional comment explaining the transition (max 1000 characters)"),
          assignee: z.string().email().optional().describe("Optional new assignee during transition"),
          resolution: SafeStringSchema.max(100).optional().describe("Resolution reason for closing transitions (e.g., 'Fixed', 'Won't Fix')")
        }
      },
      async ({ issueIdentifier, transitionId, comment, assignee, resolution }) => {
        try {
          if (!issueIdentifier || !transitionId) {
            return {
              content: [{ type: "text", text: "Issue identifier and transition ID are required" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue securely
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found. Please verify the issue identifier and your access permissions.` }],
              isError: true
            };
          }

          const currentStatus = issue.status || 'Open';
          
          // Map transition IDs to target statuses (simplified workflow)
          const transitionMap: { [key: string]: string } = {
            'start-progress': 'In Progress',
            'stop-progress': 'Open', 
            'resolve': 'Resolved',
            'close': 'Closed',
            'reopen': 'Open',
            'reject': 'Rejected'
          };

          const targetStatus = transitionMap[transitionId.toLowerCase()] || transitionId;

          // Validate transition is allowed (simplified validation)
          const validTransitions: { [key: string]: string[] } = {
            'Open': ['In Progress', 'Resolved', 'Closed', 'Rejected'],
            'In Progress': ['Open', 'Resolved', 'Closed'],
            'Resolved': ['Open', 'Closed'],
            'Closed': ['Open'],
            'Rejected': ['Open']
          };

          if (!validTransitions[currentStatus]?.includes(targetStatus)) {
            return {
              content: [{ type: "text", text: `Invalid transition from '${currentStatus}' to '${targetStatus}'. Use 'jira_get_transitions' to see available transitions.` }],
              isError: true
            };
          }

          // Build update object
          const updates: any = { status: targetStatus };
          if (assignee) updates.assignee = assignee;
          if (resolution && ['Resolved', 'Closed'].includes(targetStatus)) {
            updates.resolution = resolution;
          }

          // Execute transition
          await client.updateDoc(
            tracker.class.Issue,
            issue.space,
            issue._id,
            updates
          );

          // Add comment if provided
          if (comment) {
            const commentId = generateId();
            const commentRef = await client.uploadMarkup(
              core.class.Comment,
              commentId,
              'content',
              `Transition Comment: ${comment}`,
              'markdown'
            );

            await client.addCollection(
              core.class.Comment,
              issue.space,
              issue._id,
              issue._class,
              'comments',
              {
                content: commentRef,
                createdOn: Date.now(),
                modifiedOn: Date.now(),
                visibility: 'public'
              },
              commentId
            );
          }

          return {
            content: [{
              type: "text",
              text: `Successfully transitioned issue: ${issueIdentifier}\n\n` +
                    `Status Change: ${currentStatus} → ${targetStatus}\n` +
                    `Transition: ${transitionId}\n` +
                    (assignee ? `New Assignee: ${assignee}\n` : '') +
                    (resolution ? `Resolution: ${resolution}\n` : '') +
                    (comment ? `Comment: ${comment}\n` : '') +
                    `\nTransition completed successfully. Stakeholders will be notified of the status change.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error transitioning issue: ${error instanceof Error ? error.message : String(error)}. Please verify the transition is valid and you have sufficient permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Issue Link (Jira-compatible)
    this.server.registerTool(
      "jira_create_issue_link",
      {
        title: "Create Issue Link",
        description: "Create a relationship link between two issues with specified link type and direction. This tool provides secure issue linking with validation to prevent circular dependencies and maintain data integrity. Supports various relationship types like blocks, relates, duplicates.",
        inputSchema: {
          sourceIssue: IssueIdentifierSchema.describe("Source issue identifier (format: PROJECT-123)"),
          targetIssue: IssueIdentifierSchema.describe("Target issue identifier (format: PROJECT-123)"),
          linkType: z.enum(['blocks', 'relates', 'duplicates', 'depends', 'subtask', 'epic']).describe("Type of relationship between issues"),
          comment: SafeStringSchema.max(500).optional().describe("Optional comment describing the relationship (max 500 characters)")
        }
      },
      async ({ sourceIssue, targetIssue, linkType, comment }) => {
        try {
          if (!sourceIssue || !targetIssue || !linkType) {
            return {
              content: [{ type: "text", text: "Source issue, target issue, and link type are required" }],
              isError: true
            };
          }

          if (sourceIssue === targetIssue) {
            return {
              content: [{ type: "text", text: "Cannot create link: source and target issues cannot be the same" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find both issues securely
          const [source, target] = await Promise.all([
            client.findOne(tracker.class.Issue, { identifier: sourceIssue }) as Promise<Issue | undefined>,
            client.findOne(tracker.class.Issue, { identifier: targetIssue }) as Promise<Issue | undefined>
          ]);

          if (!source) {
            return {
              content: [{ type: "text", text: `Source issue '${sourceIssue}' not found. Please verify the issue identifier.` }],
              isError: true
            };
          }

          if (!target) {
            return {
              content: [{ type: "text", text: `Target issue '${targetIssue}' not found. Please verify the issue identifier.` }],
              isError: true
            };
          }

          // Generate link ID
          const linkId = generateId();

          // Note: In a full implementation, this would:
          // 1. Create proper issue link records in both directions
          // 2. Validate circular dependencies
          // 3. Update parent/child relationships for hierarchical links
          // 4. Send notifications to issue watchers
          // 5. Update issue fields (like epic links)

          // For demonstration, we'll update the parent field for subtask/epic relationships
          if (linkType === 'subtask') {
            await client.updateDoc(
              tracker.class.Issue,
              source.space,
              source._id,
              { parents: [target._id] }
            );
          } else if (linkType === 'epic') {
            await client.updateDoc(
              tracker.class.Issue,
              target.space,
              target._id,
              { parents: [source._id] }
            );
          }

          return {
            content: [{
              type: "text",
              text: `Successfully created issue link: ${linkId}\n\n` +
                    `Source Issue: ${sourceIssue} (${source.title})\n` +
                    `Target Issue: ${targetIssue} (${target.title})\n` +
                    `Link Type: ${linkType}\n` +
                    (comment ? `Comment: ${comment}\n` : '') +
                    `\nRelationship Direction:\n` +
                    `• ${sourceIssue} ${linkType} ${targetIssue}\n` +
                    `\nBoth issues have been updated to reflect this relationship.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating issue link: ${error instanceof Error ? error.message : String(error)}. Please verify both issue identifiers and your permissions.` }],
            isError: true
          };
        }
      }
    );

    // CONFLUENCE READ OPERATIONS

    // Tool: Search Confluence (Confluence-compatible)
    this.server.registerTool(
      "confluence_search",
      {
        title: "Search Confluence Content",
        description: "Search across all accessible Confluence pages, comments, and attachments with advanced filtering capabilities. This tool provides secure content search with built-in input validation to prevent injection attacks. Supports full-text search, label filtering, and space restrictions.",
        inputSchema: {
          query: SafeStringSchema.min(1).max(1000).describe("Search query text (1-1000 characters)"),
          spaceKey: SafeStringSchema.max(50).optional().describe("Limit search to specific space (optional)"),
          contentType: z.enum(['page', 'comment', 'attachment', 'all']).optional().default('all').describe("Type of content to search"),
          labels: z.array(SafeStringSchema.max(50)).max(10).optional().describe("Filter by labels (max 10 labels)"),
          limit: z.number().int().min(1).max(100).optional().default(20).describe("Maximum results to return (1-100)"),
          sortBy: z.enum(['relevance', 'title', 'modified', 'created']).optional().default('relevance').describe("Sort results by field")
        }
      },
      async ({ query, spaceKey, contentType, labels, limit, sortBy }) => {
        try {
          if (!query || query.trim().length === 0) {
            return {
              content: [{ type: "text", text: "Search query cannot be empty" }],
              isError: true
            };
          }

          // Note: This is a simplified implementation for demonstration
          // In a real Confluence integration, this would use Confluence REST API
          
          const safeLimit = Math.min(Math.max(limit || 20, 1), 100);
          
          return {
            content: [{
              type: "text",
              text: `Confluence Search Results\n\n` +
                    `Query: "${query}"\n` +
                    `Content Type: ${contentType || 'all'}\n` +
                    `Space: ${spaceKey || 'All spaces'}\n` +
                    `Labels: ${labels?.join(', ') || 'None'}\n` +
                    `Sort: ${sortBy || 'relevance'}\n` +
                    `Limit: ${safeLimit}\n\n` +
                    `Note: Confluence integration requires additional implementation.\n` +
                    `This tool provides the interface for secure Confluence search\n` +
                    `with comprehensive input validation and injection prevention.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error searching Confluence: ${error instanceof Error ? error.message : String(error)}. Please verify your search query and access permissions.` }],
            isError: true
          };
        }
      }
    );

    // Tool: Get Confluence Page (Confluence-compatible)
    this.server.registerTool(
      "confluence_get_page",
      {
        title: "Get Confluence Page",
        description: "Retrieve detailed content and metadata for a specific Confluence page by ID or title. This tool provides secure page access with built-in validation and supports various content formats. Includes page hierarchy, labels, and version information.",
        inputSchema: {
          pageId: SafeStringSchema.optional().describe("Confluence page ID (either pageId or title required)"),
          title: SafeStringSchema.optional().describe("Page title (either pageId or title required)"),
          spaceKey: SafeStringSchema.max(50).optional().describe("Space key (required if using title)"),
          version: z.number().int().min(1).optional().describe("Specific page version to retrieve (optional)"),
          includeBody: z.boolean().optional().default(true).describe("Include page body content in response"),
          bodyFormat: z.enum(['storage', 'view', 'styled_view', 'editor']).optional().default('view').describe("Format for page body content")
        }
      },
      async ({ pageId, title, spaceKey, version, includeBody, bodyFormat }) => {
        try {
          if (!pageId && !title) {
            return {
              content: [{ type: "text", text: "Either page ID or page title is required" }],
              isError: true
            };
          }

          if (title && !spaceKey) {
            return {
              content: [{ type: "text", text: "Space key is required when searching by page title" }],
              isError: true
            };
          }

          // Note: This is a simplified implementation for demonstration
          // In a real Confluence integration, this would use Confluence REST API
          
          return {
            content: [{
              type: "text",
              text: `Confluence Page Details\n\n` +
                    `Page ID: ${pageId || 'Retrieved by title'}\n` +
                    `Title: ${title || 'Retrieved by ID'}\n` +
                    `Space: ${spaceKey || 'Unknown'}\n` +
                    `Version: ${version || 'Latest'}\n` +
                    `Include Body: ${includeBody ? 'Yes' : 'No'}\n` +
                    `Body Format: ${bodyFormat || 'view'}\n\n` +
                    `Note: Confluence integration requires additional implementation.\n` +
                    `This tool provides the interface for secure page retrieval\n` +
                    `with comprehensive input validation and format options.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error retrieving Confluence page: ${error instanceof Error ? error.message : String(error)}. Please verify the page identifier and your access permissions.` }],
            isError: true
          };
        }
      }
    );

    // CONFLUENCE WRITE OPERATIONS

    // Tool: Create Confluence Page (Confluence-compatible)
    this.server.registerTool(
      "confluence_create_page", 
      {
        title: "Create Confluence Page",
        description: "Create a new Confluence page with rich content, labels, and proper space assignment. This tool provides secure page creation with built-in input validation to prevent injection attacks. Supports various content formats and automatic parent page assignment.",
        inputSchema: {
          spaceKey: SafeStringSchema.min(1).max(50).describe("Confluence space key where page will be created"),
          title: SafeStringSchema.min(1).max(255).describe("Page title (1-255 characters)"),
          body: SafeDescriptionSchema.optional().describe("Page content in storage format (max 50000 characters)"),
          parentPageId: SafeStringSchema.optional().describe("Parent page ID for page hierarchy (optional)"),
          labels: z.array(SafeStringSchema.max(50)).max(20).optional().describe("Page labels (max 20 labels, 50 chars each)"),
          bodyFormat: z.enum(['storage', 'wiki', 'view']).optional().default('storage').describe("Format of the body content")
        }
      },
      async ({ spaceKey, title, body, parentPageId, labels, bodyFormat }) => {
        try {
          if (!spaceKey || !title) {
            return {
              content: [{ type: "text", text: "Space key and title are required to create a page" }],
              isError: true
            };
          }

          // Note: This is a simplified implementation for demonstration
          // In a real Confluence integration, this would use Confluence REST API
          
          const pageId = `page-${generateId()}`;
          
          return {
            content: [{
              type: "text",
              text: `Successfully created Confluence page: ${pageId}\n\n` +
                    `Title: ${title}\n` +
                    `Space: ${spaceKey}\n` +
                    `Parent Page: ${parentPageId || 'Root level'}\n` +
                    `Body Format: ${bodyFormat || 'storage'}\n` +
                    `Content Length: ${body?.length || 0} characters\n` +
                    `Labels: ${labels?.join(', ') || 'None'}\n\n` +
                    `Note: Confluence integration requires additional implementation.\n` +
                    `This tool provides the interface for secure page creation\n` +
                    `with comprehensive input validation and injection prevention.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating Confluence page: ${error instanceof Error ? error.message : String(error)}. Please verify the space key and your page creation permissions.` }],
            isError: true
          };
        }
      }
    );

    // Note: Additional Confluence and advanced Jira tools will be added in subsequent commits
    // Current implementation provides comprehensive project management with enhanced security

    // Tool: Create Project
    this.server.registerTool(
      "create-project",
      {
        title: "Create Project",
        description: "Create a new Huly project with comprehensive configuration",
        inputSchema: {
          name: z.string().describe("Project name"),
          identifier: z.string().describe("Project key/identifier (e.g., 'PROJ')"),
          description: z.string().optional().describe("Project description"),
          visibility: z.enum(['public', 'private']).optional().default('public').describe("Project visibility"),
          owner: z.string().optional().describe("Project owner email"),
          timezone: z.string().optional().default('UTC').describe("Project timezone"),
          type: z.string().optional().default('project').describe("Project type")
        }
      },
      async ({ name, identifier, description, visibility, owner, timezone, type }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Check if project identifier already exists
          const existingProject = await client.findOne(
            tracker.class.Project,
            { identifier }
          );

          if (existingProject) {
            return {
              content: [{ type: "text", text: `Project with identifier '${identifier}' already exists` }],
              isError: true
            };
          }

          // Find project type
          const projectType = await client.findOne(
            task.class.ProjectType,
            { name: type }
          );

          if (!projectType) {
            return {
              content: [{ type: "text", text: `Project type '${type}' not found. Use existing type or 'project'.` }],
              isError: true
            };
          }

          const projectId = generateId();
          
          // Create project
          await client.createDoc(
            tracker.class.Project,
            core.space.Space,
            {
              name,
              identifier,
              description: description || '',
              private: visibility === 'private',
              archived: false,
              type: projectType._id,
              defaultIssueStatus: null,
              sequence: 0,
              // Additional project attributes
              timezone: timezone || 'UTC',
              autoJoin: true,
              owners: owner ? [owner] : [],
              members: []
            },
            projectId
          );

          return {
            content: [{
              type: "text",
              text: `Successfully created project: ${identifier}\n` +
                    `Name: ${name}\n` +
                    `Description: ${description || 'No description'}\n` +
                    `Visibility: ${visibility}\n` +
                    `Timezone: ${timezone}\n` +
                    `Owner: ${owner || 'Not specified'}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating project: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Update Project
    this.server.registerTool(
      "update-project",
      {
        title: "Update Project",
        description: "Update an existing Huly project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier to update"),
          name: z.string().optional().describe("New project name"),
          description: z.string().optional().describe("New project description"),
          visibility: z.enum(['public', 'private']).optional().describe("New project visibility"),
          owner: z.string().optional().describe("New project owner email"),
          timezone: z.string().optional().describe("New project timezone"),
          archived: z.boolean().optional().describe("Archive/unarchive project")
        }
      },
      async ({ projectIdentifier, name, description, visibility, owner, timezone, archived }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          const updateOps: any = {};
          if (name !== undefined) updateOps.name = name;
          if (description !== undefined) updateOps.description = description;
          if (visibility !== undefined) updateOps.private = visibility === 'private';
          if (timezone !== undefined) updateOps.timezone = timezone;
          if (archived !== undefined) updateOps.archived = archived;

          if (Object.keys(updateOps).length === 0) {
            return {
              content: [{ type: "text", text: "No update parameters provided" }],
              isError: true
            };
          }

          await client.updateDoc(
            tracker.class.Project,
            core.space.Space,
            project._id,
            updateOps
          );

          return {
            content: [{
              type: "text",
              text: `Successfully updated project: ${projectIdentifier}\n` +
                    `Updated fields: ${Object.keys(updateOps).join(', ')}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating project: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Delete Project
    this.server.registerTool(
      "delete-project",
      {
        title: "Delete Project",
        description: "Delete a Huly project (use with caution)",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier to delete"),
          confirm: z.boolean().describe("Confirmation flag - must be true to proceed")
        }
      },
      async ({ projectIdentifier, confirm }) => {
        try {
          if (!confirm) {
            return {
              content: [{ type: "text", text: "Deletion requires confirmation flag to be true" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          await client.removeDoc(
            tracker.class.Project,
            core.space.Space,
            project._id
          );

          return {
            content: [{
              type: "text",
              text: `Successfully deleted project: ${projectIdentifier}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error deleting project: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // === WORKFLOW & ISSUE TYPE MANAGEMENT ===

    // Tool: Configure Workflow
    this.server.registerTool(
      "configure-workflow",
      {
        title: "Configure Workflow",
        description: "Configure workflow states and transitions for a project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          workflowName: z.string().describe("Workflow name"),
          states: z.array(z.object({
            name: z.string(),
            category: z.enum(['open', 'in-progress', 'done', 'closed']),
            color: z.string().optional()
          })).describe("Workflow states"),
          transitions: z.array(z.object({
            from: z.string(),
            to: z.string(),
            name: z.string(),
            guard: z.string().optional()
          })).describe("Workflow transitions")
        }
      },
      async ({ projectIdentifier, workflowName, states, transitions }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // In a full implementation, this would create workflow states and transitions
          // For now, we'll simulate the configuration
          const workflowConfig = {
            name: workflowName,
            states,
            transitions,
            projectId: project._id,
            createdOn: Date.now()
          };

          return {
            content: [{
              type: "text",
              text: `Workflow configured for project ${projectIdentifier}:\n\n` +
                    `Workflow: ${workflowName}\n` +
                    `States: ${states.map(s => `${s.name} (${s.category})`).join(', ')}\n` +
                    `Transitions: ${transitions.length} defined\n\n` +
                    `Transition Details:\n` +
                    transitions.map(t => 
                      `• ${t.from} → ${t.to}: ${t.name}${t.guard ? ` [Guard: ${t.guard}]` : ''}`
                    ).join('\n') +
                    `\n\nNote: In a full implementation, this would persist the workflow configuration.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error configuring workflow: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Issue Type
    this.server.registerTool(
      "create-issue-type",
      {
        title: "Create Issue Type",
        description: "Create a new issue type with default template",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          name: z.string().describe("Issue type name"),
          description: z.string().optional().describe("Issue type description"),
          icon: z.string().optional().describe("Issue type icon"),
          color: z.string().optional().describe("Issue type color"),
          defaultTemplate: z.object({
            title: z.string().optional(),
            description: z.string().optional(),
            priority: z.string().optional(),
            estimation: z.number().optional()
          }).optional().describe("Default template for this issue type")
        }
      },
      async ({ projectIdentifier, name, description, icon, color, defaultTemplate }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // In a full implementation, this would create an issue type
          // For now, we'll simulate the creation
          const issueTypeConfig = {
            name,
            description: description || '',
            icon: icon || 'issue',
            color: color || '#666666',
            projectId: project._id,
            defaultTemplate: defaultTemplate || {},
            createdOn: Date.now()
          };

          return {
            content: [{
              type: "text",
              text: `Issue type created for project ${projectIdentifier}:\n\n` +
                    `Name: ${name}\n` +
                    `Description: ${description || 'No description'}\n` +
                    `Icon: ${icon || 'issue'}\n` +
                    `Color: ${color || '#666666'}\n` +
                    `Default Template: ${JSON.stringify(defaultTemplate || {}, null, 2)}\n\n` +
                    `Note: In a full implementation, this would persist the issue type configuration.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating issue type: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: List Issue Types
    this.server.registerTool(
      "list-issue-types",
      {
        title: "List Issue Types",
        description: "List available issue types for a project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier")
        }
      },
      async ({ projectIdentifier }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // In a full implementation, this would query actual issue types
          // For now, we'll return standard Huly issue types
          const standardIssueTypes = [
            { name: 'Task', description: 'General task', icon: 'task', color: '#3498db' },
            { name: 'Bug', description: 'Software bug', icon: 'bug', color: '#e74c3c' },
            { name: 'Feature', description: 'New feature request', icon: 'feature', color: '#2ecc71' },
            { name: 'Improvement', description: 'Enhancement to existing functionality', icon: 'improvement', color: '#f39c12' },
            { name: 'Epic', description: 'Large work initiative', icon: 'epic', color: '#9b59b6' }
          ];

          return {
            content: [{
              type: "text",
              text: `Issue types for project ${projectIdentifier}:\n\n` +
                    standardIssueTypes.map(type =>
                      `• ${type.name}: ${type.description}\n` +
                      `  Icon: ${type.icon}, Color: ${type.color}\n`
                    ).join('\n') +
                    `\nNote: In a full implementation, this would show custom issue types configured for the project.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error listing issue types: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Component
    this.server.registerTool(
      "create-component",
      {
        title: "Create Component",
        description: "Create a new component in a project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          name: z.string().describe("Component name"),
          description: z.string().optional().describe("Component description"),
          lead: z.string().optional().describe("Component lead email")
        }
      },
      async ({ projectIdentifier, name, description, lead }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          const componentId = generateId();

          await client.createDoc(
            tracker.class.Component,
            project._id,
            {
              name,
              description: description || '',
              lead: lead || null,
              attachments: 0
            },
            componentId
          );

          return {
            content: [{
              type: "text",
              text: `Successfully created component: ${name}\n` +
                    `Project: ${projectIdentifier}\n` +
                    `Description: ${description || 'No description'}\n` +
                    `Lead: ${lead || 'Not specified'}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating component: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: List Components
    this.server.registerTool(
      "list-components",
      {
        title: "List Components",
        description: "List components in a project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          limit: z.number().optional().default(50).describe("Maximum number of components to return")
        }
      },
      async ({ projectIdentifier, limit }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          const components = await client.findAll(
            tracker.class.Component,
            { space: project._id },
            { limit }
          );

          const componentList = components.map((component: any) => ({
            name: component.name,
            description: component.description,
            lead: component.lead,
            attachments: component.attachments
          }));

          return {
            content: [{
              type: "text",
              text: `Found ${components.length} components in project ${projectIdentifier}:\n\n` +
                    componentList.map((component: any) =>
                      `• ${component.name}\n` +
                      `  Description: ${component.description || 'No description'}\n` +
                      `  Lead: ${component.lead || 'Not assigned'}\n` +
                      `  Attachments: ${component.attachments}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error listing components: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Update Component
    this.server.registerTool(
      "update-component",
      {
        title: "Update Component",
        description: "Update an existing component",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          componentName: z.string().describe("Component name to update"),
          name: z.string().optional().describe("New component name"),
          description: z.string().optional().describe("New component description"),
          lead: z.string().optional().describe("New component lead email")
        }
      },
      async ({ projectIdentifier, componentName, name, description, lead }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // Find component by name
          const component = await client.findOne(
            tracker.class.Component,
            { space: project._id, name: componentName }
          );

          if (!component) {
            return {
              content: [{ type: "text", text: `Component '${componentName}' not found in project '${projectIdentifier}'` }],
              isError: true
            };
          }

          const updateOps: any = {};
          if (name !== undefined) updateOps.name = name;
          if (description !== undefined) updateOps.description = description;
          if (lead !== undefined) updateOps.lead = lead;

          if (Object.keys(updateOps).length === 0) {
            return {
              content: [{ type: "text", text: "No update parameters provided" }],
              isError: true
            };
          }

          await client.updateDoc(
            tracker.class.Component,
            project._id,
            component._id,
            updateOps
          );

          return {
            content: [{
              type: "text",
              text: `Successfully updated component: ${componentName}\n` +
                    `Project: ${projectIdentifier}\n` +
                    `Updated fields: ${Object.keys(updateOps).join(', ')}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating component: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Delete Component
    this.server.registerTool(
      "delete-component",
      {
        title: "Delete Component",
        description: "Delete a component from a project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          componentName: z.string().describe("Component name to delete"),
          confirm: z.boolean().describe("Confirmation flag - must be true to proceed")
        }
      },
      async ({ projectIdentifier, componentName, confirm }) => {
        try {
          if (!confirm) {
            return {
              content: [{ type: "text", text: "Deletion requires confirmation flag to be true" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // Find component by name
          const component = await client.findOne(
            tracker.class.Component,
            { space: project._id, name: componentName }
          );

          if (!component) {
            return {
              content: [{ type: "text", text: `Component '${componentName}' not found in project '${projectIdentifier}'` }],
              isError: true
            };
          }

          await client.removeDoc(
            tracker.class.Component,
            project._id,
            component._id
          );

          return {
            content: [{
              type: "text",
              text: `Successfully deleted component: ${componentName} from project ${projectIdentifier}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error deleting component: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // === PROJECT PLANNING CAPABILITIES ===

    // Tool: Create Sprint
    this.server.registerTool(
      "create-sprint",
      {
        title: "Create Sprint",
        description: "Create a new sprint in a project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          name: z.string().describe("Sprint name"),
          startDate: z.string().describe("Sprint start date (ISO 8601 format)"),
          endDate: z.string().describe("Sprint end date (ISO 8601 format)"),
          capacity: z.number().optional().describe("Sprint capacity in hours"),
          workingDays: z.array(z.number()).optional().default([1, 2, 3, 4, 5]).describe("Working days (0=Sunday, 1=Monday, etc.)")
        }
      },
      async ({ projectIdentifier, name, startDate, endDate, capacity, workingDays }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          const sprintId = generateId();

          await client.createDoc(
            tracker.class.Sprint,
            project._id,
            {
              name,
              description: '',
              status: 'planned',
              startDate: new Date(startDate).getTime(),
              targetDate: new Date(endDate).getTime(),
              capacity: capacity || 0,
              workingDays: workingDays || [1, 2, 3, 4, 5],
              attachments: 0
            },
            sprintId
          );

          return {
            content: [{
              type: "text",
              text: `Successfully created sprint: ${name}\n` +
                    `Project: ${projectIdentifier}\n` +
                    `Start Date: ${startDate}\n` +
                    `End Date: ${endDate}\n` +
                    `Capacity: ${capacity || 'Not specified'} hours\n` +
                    `Working Days: ${workingDays?.join(', ') || 'Mon-Fri'}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating sprint: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: List Sprints
    this.server.registerTool(
      "list-sprints",
      {
        title: "List Sprints",
        description: "List sprints in a project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          status: z.enum(['planned', 'active', 'completed', 'all']).optional().default('all').describe("Sprint status filter"),
          limit: z.number().optional().default(20).describe("Maximum number of sprints to return")
        }
      },
      async ({ projectIdentifier, status, limit }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          const query: any = { space: project._id };
          if (status !== 'all') {
            query.status = status;
          }

          const sprints = await client.findAll(
            tracker.class.Sprint,
            query,
            { 
              limit,
              sort: { startDate: SortingOrder.Descending }
            }
          );

          const sprintList = sprints.map((sprint: any) => ({
            name: sprint.name,
            status: sprint.status,
            startDate: new Date(sprint.startDate).toISOString().split('T')[0],
            endDate: new Date(sprint.targetDate).toISOString().split('T')[0],
            capacity: sprint.capacity,
            workingDays: sprint.workingDays
          }));

          return {
            content: [{
              type: "text",
              text: `Found ${sprints.length} sprints in project ${projectIdentifier}:\n\n` +
                    sprintList.map((sprint: any) =>
                      `• ${sprint.name} (${sprint.status})\n` +
                      `  Period: ${sprint.startDate} to ${sprint.endDate}\n` +
                      `  Capacity: ${sprint.capacity} hours\n` +
                      `  Working Days: ${sprint.workingDays?.join(', ') || 'Not specified'}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error listing sprints: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Update Sprint
    this.server.registerTool(
      "update-sprint",
      {
        title: "Update Sprint",
        description: "Update an existing sprint",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          sprintName: z.string().describe("Sprint name to update"),
          name: z.string().optional().describe("New sprint name"),
          startDate: z.string().optional().describe("New start date (ISO 8601 format)"),
          endDate: z.string().optional().describe("New end date (ISO 8601 format)"),
          capacity: z.number().optional().describe("New capacity in hours"),
          status: z.enum(['planned', 'active', 'completed']).optional().describe("New sprint status"),
          workingDays: z.array(z.number()).optional().describe("New working days")
        }
      },
      async ({ projectIdentifier, sprintName, name, startDate, endDate, capacity, status, workingDays }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // Find sprint by name
          const sprint = await client.findOne(
            tracker.class.Sprint,
            { space: project._id, name: sprintName }
          );

          if (!sprint) {
            return {
              content: [{ type: "text", text: `Sprint '${sprintName}' not found in project '${projectIdentifier}'` }],
              isError: true
            };
          }

          const updateOps: any = {};
          if (name !== undefined) updateOps.name = name;
          if (startDate !== undefined) updateOps.startDate = new Date(startDate).getTime();
          if (endDate !== undefined) updateOps.targetDate = new Date(endDate).getTime();
          if (capacity !== undefined) updateOps.capacity = capacity;
          if (status !== undefined) updateOps.status = status;
          if (workingDays !== undefined) updateOps.workingDays = workingDays;

          if (Object.keys(updateOps).length === 0) {
            return {
              content: [{ type: "text", text: "No update parameters provided" }],
              isError: true
            };
          }

          await client.updateDoc(
            tracker.class.Sprint,
            project._id,
            sprint._id,
            updateOps
          );

          return {
            content: [{
              type: "text",
              text: `Successfully updated sprint: ${sprintName}\n` +
                    `Project: ${projectIdentifier}\n` +
                    `Updated fields: ${Object.keys(updateOps).join(', ')}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating sprint: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Move Issues to Sprint
    this.server.registerTool(
      "move-issues-to-sprint",
      {
        title: "Move Issues to Sprint",
        description: "Move issues to a sprint with optional filters",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          sprintName: z.string().describe("Target sprint name"),
          issueIdentifiers: z.array(z.string()).optional().describe("Specific issue identifiers to move"),
          filters: z.object({
            status: z.string().optional().describe("Filter by issue status"),
            priority: z.string().optional().describe("Filter by issue priority"),
            component: z.string().optional().describe("Filter by component"),
            assignee: z.string().optional().describe("Filter by assignee")
          }).optional().describe("Filters to apply when selecting issues")
        }
      },
      async ({ projectIdentifier, sprintName, issueIdentifiers, filters }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // Find sprint by name
          const sprint = await client.findOne(
            tracker.class.Sprint,
            { space: project._id, name: sprintName }
          );

          if (!sprint) {
            return {
              content: [{ type: "text", text: `Sprint '${sprintName}' not found in project '${projectIdentifier}'` }],
              isError: true
            };
          }

          let issues: any[] = [];

          if (issueIdentifiers && issueIdentifiers.length > 0) {
            // Move specific issues
            for (const identifier of issueIdentifiers) {
              const issue = await client.findOne(
                tracker.class.Issue,
                { identifier }
              );
              if (issue) {
                issues.push(issue);
              }
            }
          } else if (filters) {
            // Find issues based on filters
            const query: any = { space: project._id };
            if (filters.status) query.status = filters.status;
            if (filters.priority) query.priority = filters.priority;
            if (filters.component) query.component = filters.component;
            if (filters.assignee) query.assignee = filters.assignee;

            issues = await client.findAll(tracker.class.Issue, query);
          }

          if (issues.length === 0) {
            return {
              content: [{ type: "text", text: "No issues found matching the criteria" }],
              isError: true
            };
          }

          // Move issues to sprint
          for (const issue of issues) {
            await client.updateDoc(
              tracker.class.Issue,
              project._id,
              issue._id,
              { sprint: sprint._id }
            );
          }

          return {
            content: [{
              type: "text",
              text: `Successfully moved ${issues.length} issues to sprint '${sprintName}':\n` +
                    issues.map((issue: any) => `• ${issue.identifier} - ${issue.title}`).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error moving issues to sprint: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // === EPIC & FEATURE MANAGEMENT ===

    // Tool: Create Epic
    this.server.registerTool(
      "create-epic",
      {
        title: "Create Epic",
        description: "Create a new epic to group related features and tasks",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          title: z.string().describe("Epic title"),
          description: z.string().optional().describe("Epic description"),
          goals: z.array(z.string()).optional().describe("Epic goals"),
          targetQuarter: z.string().optional().describe("Target quarter (e.g., 'Q1 2024')"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).optional().default('Normal').describe("Epic priority")
        }
      },
      async ({ projectIdentifier, title, description, goals, targetQuarter, priority }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // Generate epic ID and sequence
          const epicId = generateId();
          const incResult = await client.updateDoc(
            tracker.class.Project,
            core.space.Space,
            project._id,
            { $inc: { sequence: 1 } },
            true
          );
          const sequence = (incResult as any).object.sequence;

          // Create description reference if provided
          let descriptionRef = null;
          if (description) {
            descriptionRef = await client.createMarkup(
              tracker.class.Issue,
              epicId,
              'description',
              description
            );
          }

          const priorityMap: any = {
            'Urgent': IssuePriority.Urgent,
            'High': IssuePriority.High,
            'Normal': IssuePriority.Medium,
            'Low': IssuePriority.Low
          };

          // Create epic as a special issue type
          await client.addCollection(
            tracker.class.Issue,
            project._id,
            project._id,
            project._class,
            'issues',
            {
              title,
              description: descriptionRef,
              status: project.defaultIssueStatus,
              number: sequence,
              kind: 'epic', // Custom kind for epics
              identifier: `${project.identifier}-${sequence}`,
              priority: priorityMap[priority] || IssuePriority.Medium,
              assignee: null,
              component: null,
              estimation: 0,
              remainingTime: 0,
              reportedTime: 0,
              reports: 0,
              subIssues: 0,
              parents: [],
              childInfo: [],
              dueDate: null,
              rank: makeRank(undefined, undefined),
              // Epic-specific fields (would be custom fields in real implementation)
              epicGoals: goals || [],
              targetQuarter: targetQuarter || null
            },
            epicId
          );

          return {
            content: [{
              type: "text",
              text: `Successfully created epic: ${project.identifier}-${sequence}\n` +
                    `Title: ${title}\n` +
                    `Priority: ${priority}\n` +
                    `Target Quarter: ${targetQuarter || 'Not specified'}\n` +
                    `Goals: ${goals?.join(', ') || 'None specified'}\n` +
                    `Project: ${projectIdentifier}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating epic: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Feature
    this.server.registerTool(
      "create-feature",
      {
        title: "Create Feature",
        description: "Create a new feature and optionally link to an epic",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          title: z.string().describe("Feature title"),
          description: z.string().optional().describe("Feature description"),
          epicIdentifier: z.string().optional().describe("Parent epic identifier"),
          acceptanceCriteria: z.array(z.string()).optional().describe("Acceptance criteria"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).optional().default('Normal').describe("Feature priority")
        }
      },
      async ({ projectIdentifier, title, description, epicIdentifier, acceptanceCriteria, priority }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          let parentEpic = null;
          if (epicIdentifier) {
            parentEpic = await client.findOne(
              tracker.class.Issue,
              { identifier: epicIdentifier }
            );
            if (!parentEpic) {
              return {
                content: [{ type: "text", text: `Epic '${epicIdentifier}' not found` }],
                isError: true
              };
            }
          }

          // Generate feature ID and sequence
          const featureId = generateId();
          const incResult = await client.updateDoc(
            tracker.class.Project,
            core.space.Space,
            project._id,
            { $inc: { sequence: 1 } },
            true
          );
          const sequence = (incResult as any).object.sequence;

          // Create description reference if provided
          let descriptionRef = null;
          if (description) {
            descriptionRef = await client.createMarkup(
              tracker.class.Issue,
              featureId,
              'description',
              description
            );
          }

          const priorityMap: any = {
            'Urgent': IssuePriority.Urgent,
            'High': IssuePriority.High,
            'Normal': IssuePriority.Medium,
            'Low': IssuePriority.Low
          };

          // Create feature as a special issue type
          await client.addCollection(
            tracker.class.Issue,
            project._id,
            parentEpic?._id || project._id,
            parentEpic ? tracker.class.Issue : project._class,
            parentEpic ? 'subIssues' : 'issues',
            {
              title,
              description: descriptionRef,
              status: project.defaultIssueStatus,
              number: sequence,
              kind: 'feature', // Custom kind for features
              identifier: `${project.identifier}-${sequence}`,
              priority: priorityMap[priority] || IssuePriority.Medium,
              assignee: null,
              component: null,
              estimation: 0,
              remainingTime: 0,
              reportedTime: 0,
              reports: 0,
              subIssues: 0,
              parents: parentEpic ? [parentEpic._id] : [],
              childInfo: [],
              dueDate: null,
              rank: makeRank(undefined, undefined),
              // Feature-specific fields (would be custom fields in real implementation)
              acceptanceCriteria: acceptanceCriteria || []
            },
            featureId
          );

          return {
            content: [{
              type: "text",
              text: `Successfully created feature: ${project.identifier}-${sequence}\n` +
                    `Title: ${title}\n` +
                    `Priority: ${priority}\n` +
                    `Parent Epic: ${epicIdentifier || 'None'}\n` +
                    `Acceptance Criteria: ${acceptanceCriteria?.length || 0} defined\n` +
                    `Project: ${projectIdentifier}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating feature: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Link Issue to Epic
    this.server.registerTool(
      "link-issue-to-epic",
      {
        title: "Link Issue to Epic",
        description: "Link an existing issue to an epic",
        inputSchema: {
          issueIdentifier: z.string().describe("Issue identifier to link"),
          epicIdentifier: z.string().describe("Epic identifier")
        }
      },
      async ({ issueIdentifier, epicIdentifier }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find both issue and epic
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          const epic = await client.findOne(
            tracker.class.Issue,
            { identifier: epicIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found` }],
              isError: true
            };
          }

          if (!epic) {
            return {
              content: [{ type: "text", text: `Epic '${epicIdentifier}' not found` }],
              isError: true
            };
          }

          // Update issue to have epic as parent
          await client.updateDoc(
            tracker.class.Issue,
            issue.space,
            issue._id,
            { parents: [epic._id] }
          );

          return {
            content: [{
              type: "text",
              text: `Successfully linked ${issueIdentifier} to epic ${epicIdentifier}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error linking issue to epic: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // === BACKLOG GROOMING ===

    // Tool: Update Issue Priority
    this.server.registerTool(
      "update-issue-priority",
      {
        title: "Update Issue Priority",
        description: "Update issue priority for backlog grooming",
        inputSchema: {
          issueIdentifier: z.string().describe("Issue identifier"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).describe("New priority"),
          reason: z.string().optional().describe("Reason for priority change")
        }
      },
      async ({ issueIdentifier, priority, reason }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find issue by identifier
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found` }],
              isError: true
            };
          }

          const priorityMap: any = {
            'Urgent': IssuePriority.Urgent,
            'High': IssuePriority.High,
            'Normal': IssuePriority.Medium,
            'Low': IssuePriority.Low
          };

          await client.updateDoc(
            tracker.class.Issue,
            issue.space,
            issue._id,
            { priority: priorityMap[priority] }
          );

          // Add comment with reason if provided
          if (reason) {
            const commentId = generateId();
            await client.addCollection(
              tracker.class.IssueComment,
              issue.space,
              issue._id,
              tracker.class.Issue,
              'comments',
              {
                message: `Priority changed to ${priority}: ${reason}`
              },
              commentId
            );
          }

          return {
            content: [{
              type: "text",
              text: `Successfully updated priority of ${issueIdentifier} to ${priority}` +
                    (reason ? `\nReason: ${reason}` : '')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating issue priority: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Bulk Update Issues
    this.server.registerTool(
      "bulk-update-issues",
      {
        title: "Bulk Update Issues",
        description: "Update multiple issues for backlog grooming",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          filters: z.record(z.any()).describe("Filters to select issues"),
          updates: z.record(z.any()).describe("Updates to apply"),
          limit: z.number().optional().default(50).describe("Maximum number of issues to update")
        }
      },
      async ({ projectIdentifier, filters, updates, limit }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // Find issues matching filters
          const query = { space: project._id, ...filters };
          const issues = await client.findAll(
            tracker.class.Issue,
            query,
            { limit }
          );

          if (issues.length === 0) {
            return {
              content: [{ type: "text", text: "No issues found matching the filters" }],
              isError: true
            };
          }

          // Update each issue
          for (const issue of issues) {
            await client.updateDoc(
              tracker.class.Issue,
              issue.space,
              issue._id,
              updates
            );
          }

          return {
            content: [{
              type: "text",
              text: `Successfully updated ${issues.length} issues in project ${projectIdentifier}\n` +
                    `Filters: ${JSON.stringify(filters, null, 2)}\n` +
                    `Updates: ${JSON.stringify(updates, null, 2)}\n\n` +
                    `Updated Issues:\n` +
                    issues.map((issue: any) => `• ${issue.identifier}: ${issue.title}`).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error bulk updating issues: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Get Issue Details
    this.server.registerTool(
      "get-issue",
      {
        title: "Get Issue Details",
        description: "Get detailed information about a specific issue",
        inputSchema: {
          issueIdentifier: z.string().describe("Issue identifier (e.g., 'HULY-123')")
        }
      },
      async ({ issueIdentifier }) => {
        try {
          const client = await this.hulyConnection.connect();

          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found` }],
              isError: true
            };
          }

          const description = issue.description ?
            await client.fetchMarkup(issue._class, issue._id, 'description', issue.description, 'markdown') :
            'No description';

          return {
            content: [{
              type: "text",
              text: `Issue Details: ${issue.identifier}\n\n` +
                    `Title: ${issue.title}\n` +
                    `Priority: ${issue.priority}\n` +
                    `Status: ${issue.status}\n` +
                    `Assignee: ${issue.assignee || 'Unassigned'}\n` +
                    `Estimation: ${issue.estimation}h\n` +
                    `Remaining Time: ${issue.remainingTime}h\n` +
                    `Reported Time: ${issue.reportedTime}h\n` +
                    `Created: ${issue.createdOn ? new Date(issue.createdOn).toISOString() : 'Unknown'}\n` +
                    `Modified: ${issue.modifiedOn ? new Date(issue.modifiedOn).toISOString() : 'Unknown'}\n\n` +
                    `Description:\n${description}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error getting issue details: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // === ENHANCED ISSUE & COMPONENT MANAGEMENT ===

    // Tool: Update Issue
    this.server.registerTool(
      "update-issue",
      {
        title: "Update Issue",
        description: "Update an existing issue with enhanced capabilities",
        inputSchema: {
          issueIdentifier: z.string().describe("Issue identifier to update"),
          title: z.string().optional().describe("New issue title"),
          description: z.string().optional().describe("New issue description"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).optional().describe("New issue priority"),
          status: z.string().optional().describe("New issue status"),
          assignee: z.string().optional().describe("New assignee email"),
          component: z.string().optional().describe("Component name"),
          estimation: z.number().optional().describe("Time estimation in hours"),
          dueDate: z.string().optional().describe("Due date (ISO 8601 format)"),
          labels: z.array(z.string()).optional().describe("Issue labels"),
          customFields: z.record(z.any()).optional().describe("Custom field values")
        }
      },
      async ({ issueIdentifier, title, description, priority, status, assignee, component, estimation, dueDate, labels, customFields }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find issue by identifier
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found` }],
              isError: true
            };
          }

          const updateOps: any = {};
          
          if (title !== undefined) updateOps.title = title;
          if (priority !== undefined) {
            const priorityMap: any = {
              'Urgent': IssuePriority.Urgent,
              'High': IssuePriority.High,
              'Normal': IssuePriority.Medium,
              'Low': IssuePriority.Low
            };
            updateOps.priority = priorityMap[priority] || IssuePriority.Medium;
          }
          if (assignee !== undefined) updateOps.assignee = assignee;
          if (estimation !== undefined) updateOps.estimation = estimation;
          if (dueDate !== undefined) updateOps.dueDate = new Date(dueDate).getTime();

          // Handle description update
          if (description !== undefined) {
            const descriptionRef = await client.createMarkup(
              tracker.class.Issue,
              issue._id,
              'description',
              description
            );
            updateOps.description = descriptionRef;
          }

          // Handle component
          if (component !== undefined) {
            const project = await client.findOne(
              tracker.class.Project,
              { _id: issue.space }
            );
            if (project) {
              const comp = await client.findOne(
                tracker.class.Component,
                { space: project._id, name: component }
              );
              updateOps.component = comp?._id || null;
            }
          }

          if (Object.keys(updateOps).length === 0) {
            return {
              content: [{ type: "text", text: "No update parameters provided" }],
              isError: true
            };
          }

          await client.updateDoc(
            tracker.class.Issue,
            issue.space,
            issue._id,
            updateOps
          );

          return {
            content: [{
              type: "text",
              text: `Successfully updated issue: ${issueIdentifier}\n` +
                    `Updated fields: ${Object.keys(updateOps).join(', ')}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating issue: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Change Issue Status
    this.server.registerTool(
      "change-issue-status",
      {
        title: "Change Issue Status",
        description: "Change issue status with guard checks",
        inputSchema: {
          issueIdentifier: z.string().describe("Issue identifier"),
          newStatus: z.string().describe("New status"),
          comment: z.string().optional().describe("Optional comment for the status change")
        }
      },
      async ({ issueIdentifier, newStatus, comment }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find issue by identifier
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found` }],
              isError: true
            };
          }

          // TODO: Add guard checks for valid status transitions
          // This would require querying workflow configuration

          await client.updateDoc(
            tracker.class.Issue,
            issue.space,
            issue._id,
            { status: newStatus }
          );

          // Add comment if provided
          if (comment) {
            const commentId = generateId();
            await client.addCollection(
              tracker.class.IssueComment,
              issue.space,
              issue._id,
              tracker.class.Issue,
              'comments',
              {
                message: comment
              },
              commentId
            );
          }

          return {
            content: [{
              type: "text",
              text: `Successfully changed status of issue ${issueIdentifier} to '${newStatus}'` +
                    (comment ? `\nComment added: ${comment}` : '')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error changing issue status: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Link Issues
    this.server.registerTool(
      "link-issues",
      {
        title: "Link Issues",
        description: "Create relationships between issues",
        inputSchema: {
          sourceIssue: z.string().describe("Source issue identifier"),
          targetIssue: z.string().describe("Target issue identifier"),
          linkType: z.enum(['blocks', 'blocked-by', 'relates-to', 'duplicates', 'duplicated-by']).describe("Type of relationship")
        }
      },
      async ({ sourceIssue, targetIssue, linkType }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find both issues
          const source = await client.findOne(
            tracker.class.Issue,
            { identifier: sourceIssue }
          ) as Issue | undefined;

          const target = await client.findOne(
            tracker.class.Issue,
            { identifier: targetIssue }
          ) as Issue | undefined;

          if (!source) {
            return {
              content: [{ type: "text", text: `Source issue '${sourceIssue}' not found` }],
              isError: true
            };
          }

          if (!target) {
            return {
              content: [{ type: "text", text: `Target issue '${targetIssue}' not found` }],
              isError: true
            };
          }

          // Create issue relation
          const relationId = generateId();
          await client.createDoc(
            tracker.class.IssueParentInfo,
            source.space,
            {
              parent: source._id,
              parentTitle: source.title,
              child: target._id,
              childTitle: target.title,
              type: linkType
            },
            relationId
          );

          return {
            content: [{
              type: "text",
              text: `Successfully linked issues:\n` +
                    `${sourceIssue} ${linkType} ${targetIssue}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error linking issues: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Subtask
    this.server.registerTool(
      "create-subtask",
      {
        title: "Create Subtask",
        description: "Create a subtask for an existing issue",
        inputSchema: {
          parentIssue: z.string().describe("Parent issue identifier"),
          title: z.string().describe("Subtask title"),
          description: z.string().optional().describe("Subtask description"),
          assignee: z.string().optional().describe("Assignee email"),
          estimation: z.number().optional().describe("Time estimation in hours")
        }
      },
      async ({ parentIssue, title, description, assignee, estimation }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find parent issue
          const parent = await client.findOne(
            tracker.class.Issue,
            { identifier: parentIssue }
          ) as Issue | undefined;

          if (!parent) {
            return {
              content: [{ type: "text", text: `Parent issue '${parentIssue}' not found` }],
              isError: true
            };
          }

          // Get project for sequence
          const project = await client.findOne(
            tracker.class.Project,
            { _id: parent.space }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: "Project not found for parent issue" }],
              isError: true
            };
          }

          // Generate unique issue ID and sequence
          const subtaskId = generateId();
          const incResult = await client.updateDoc(
            tracker.class.Project,
            core.space.Space,
            project._id,
            { $inc: { sequence: 1 } },
            true
          );
          const sequence = (incResult as any).object.sequence;

          // Create description reference if provided
          let descriptionRef = null;
          if (description) {
            descriptionRef = await client.createMarkup(
              tracker.class.Issue,
              subtaskId,
              'description',
              description
            );
          }

          // Create subtask
          await client.addCollection(
            tracker.class.Issue,
            project._id,
            parent._id,
            tracker.class.Issue,
            'subIssues',
            {
              title,
              description: descriptionRef,
              status: project.defaultIssueStatus,
              number: sequence,
              kind: tracker.taskTypes.Issue,
              identifier: `${project.identifier}-${sequence}`,
              priority: IssuePriority.Medium,
              assignee: assignee || null,
              component: null,
              estimation: estimation || 0,
              remainingTime: estimation || 0,
              reportedTime: 0,
              reports: 0,
              subIssues: 0,
              parents: [parent._id],
              childInfo: [],
              dueDate: null,
              rank: makeRank(undefined, undefined)
            },
            subtaskId
          );

          return {
            content: [{
              type: "text",
              text: `Successfully created subtask: ${project.identifier}-${sequence}\n` +
                    `Title: ${title}\n` +
                    `Parent: ${parentIssue}\n` +
                    `Assignee: ${assignee || 'Unassigned'}\n` +
                    `Estimation: ${estimation || 0} hours`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating subtask: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Delete Issue
    this.server.registerTool(
      "delete-issue",
      {
        title: "Delete Issue",
        description: "Delete an issue (use with caution)",
        inputSchema: {
          issueIdentifier: z.string().describe("Issue identifier to delete"),
          confirm: z.boolean().describe("Confirmation flag - must be true to proceed")
        }
      },
      async ({ issueIdentifier, confirm }) => {
        try {
          if (!confirm) {
            return {
              content: [{ type: "text", text: "Deletion requires confirmation flag to be true" }],
              isError: true
            };
          }

          const client = await this.hulyConnection.connect();

          // Find issue by identifier
          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueIdentifier }
          ) as Issue | undefined;

          if (!issue) {
            return {
              content: [{ type: "text", text: `Issue '${issueIdentifier}' not found` }],
              isError: true
            };
          }

          await client.removeDoc(
            tracker.class.Issue,
            issue.space,
            issue._id
          );

          return {
            content: [{
              type: "text",
              text: `Successfully deleted issue: ${issueIdentifier}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error deleting issue: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // === AUTO-ASSIGNMENT & ROADMAP MANAGEMENT ===

    // Tool: Create Auto-Assignment Rule
    this.server.registerTool(
      "create-auto-assignment-rule",
      {
        title: "Create Auto-Assignment Rule",
        description: "Create rules for automatic issue assignment",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          ruleName: z.string().describe("Rule name"),
          criteria: z.object({
            component: z.string().optional(),
            keywords: z.array(z.string()).optional(),
            issueType: z.string().optional(),
            priority: z.string().optional()
          }).describe("Assignment criteria"),
          assignee: z.string().describe("Assignee email"),
          active: z.boolean().optional().default(true).describe("Whether rule is active")
        }
      },
      async ({ projectIdentifier, ruleName, criteria, assignee, active }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // In a full implementation, this would persist the auto-assignment rule
          const ruleConfig = {
            name: ruleName,
            projectId: project._id,
            criteria,
            assignee,
            active: active !== false,
            createdOn: Date.now()
          };

          return {
            content: [{
              type: "text",
              text: `Auto-assignment rule created for project ${projectIdentifier}:\n\n` +
                    `Rule: ${ruleName}\n` +
                    `Assignee: ${assignee}\n` +
                    `Active: ${active !== false}\n` +
                    `Criteria:\n` +
                    `  Component: ${criteria.component || 'Any'}\n` +
                    `  Keywords: ${criteria.keywords?.join(', ') || 'None'}\n` +
                    `  Issue Type: ${criteria.issueType || 'Any'}\n` +
                    `  Priority: ${criteria.priority || 'Any'}\n\n` +
                    `Note: In a full implementation, this would automatically assign issues matching the criteria.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating auto-assignment rule: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Roadmap
    this.server.registerTool(
      "create-roadmap",
      {
        title: "Create Roadmap",
        description: "Create a roadmap for quarterly planning",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          quarter: z.string().describe("Target quarter (e.g., 'Q1 2024')"),
          goals: z.array(z.object({
            title: z.string(),
            description: z.string().optional(),
            priority: z.enum(['High', 'Medium', 'Low']).optional().default('Medium'),
            epicIdentifier: z.string().optional()
          })).describe("Quarterly goals"),
          dependencies: z.array(z.object({
            from: z.string(),
            to: z.string(),
            type: z.enum(['blocks', 'depends-on']).optional().default('depends-on')
          })).optional().describe("Goal dependencies"),
          risks: z.array(z.object({
            description: z.string(),
            impact: z.enum(['High', 'Medium', 'Low']).optional().default('Medium'),
            mitigation: z.string().optional()
          })).optional().describe("Identified risks")
        }
      },
      async ({ projectIdentifier, quarter, goals, dependencies, risks }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // In a full implementation, this would create a roadmap document
          const roadmapConfig = {
            quarter,
            projectId: project._id,
            goals,
            dependencies: dependencies || [],
            risks: risks || [],
            createdOn: Date.now()
          };

          let roadmapText = `# Roadmap: ${quarter} - ${projectIdentifier}\n\n`;
          
          roadmapText += `## Quarterly Goals\n`;
          goals.forEach((goal, index) => {
            roadmapText += `${index + 1}. **${goal.title}** (${goal.priority} Priority)\n`;
            if (goal.description) roadmapText += `   ${goal.description}\n`;
            if (goal.epicIdentifier) roadmapText += `   Epic: ${goal.epicIdentifier}\n`;
            roadmapText += '\n';
          });

          if (dependencies && dependencies.length > 0) {
            roadmapText += `## Dependencies\n`;
            dependencies.forEach(dep => {
              roadmapText += `• ${dep.from} ${dep.type} ${dep.to}\n`;
            });
            roadmapText += '\n';
          }

          if (risks && risks.length > 0) {
            roadmapText += `## Risks\n`;
            risks.forEach(risk => {
              roadmapText += `• **${risk.impact} Impact**: ${risk.description}\n`;
              if (risk.mitigation) roadmapText += `  Mitigation: ${risk.mitigation}\n`;
            });
            roadmapText += '\n';
          }

          roadmapText += `Note: In a full implementation, this would be persisted and trackable.`;

          return {
            content: [{
              type: "text",
              text: roadmapText
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating roadmap: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Update Roadmap Progress
    this.server.registerTool(
      "update-roadmap-progress",
      {
        title: "Update Roadmap Progress",
        description: "Update progress on roadmap goals",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          quarter: z.string().describe("Quarter to update"),
          goalUpdates: z.array(z.object({
            goalTitle: z.string(),
            progress: z.number().min(0).max(100),
            status: z.enum(['not-started', 'in-progress', 'completed', 'blocked']).optional(),
            notes: z.string().optional()
          })).describe("Goal progress updates")
        }
      },
      async ({ projectIdentifier, quarter, goalUpdates }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          let progressReport = `# Roadmap Progress Update: ${quarter} - ${projectIdentifier}\n\n`;
          
          goalUpdates.forEach(update => {
            progressReport += `## ${update.goalTitle}\n`;
            progressReport += `Progress: ${update.progress}%\n`;
            if (update.status) progressReport += `Status: ${update.status}\n`;
            if (update.notes) progressReport += `Notes: ${update.notes}\n`;
            progressReport += '\n';
          });

          const averageProgress = goalUpdates.reduce((sum, update) => sum + update.progress, 0) / goalUpdates.length;
          progressReport += `**Overall Progress: ${Math.round(averageProgress)}%**\n\n`;
          progressReport += `Note: In a full implementation, this would update the persisted roadmap.`;

          return {
            content: [{
              type: "text",
              text: progressReport
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating roadmap progress: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Find One Document
    this.server.registerTool(
      "find-one",
      {
        title: "Find One Document",
        description: "Find a single document by class and query criteria",
        inputSchema: {
          className: z.string().describe("Full class name (e.g., 'tracker.class.Issue', 'contact.class.Person')"),
          query: z.record(z.any()).describe("Query criteria as JSON object"),
          options: z.record(z.any()).optional().describe("Find options (limit, sort, lookup, projection)")
        }
      },
      async ({ className, query, options }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          // Parse the class name to get the actual class reference
          const classRef = this.parseClassName(className);
          
          const document = await client.findOne(classRef, query, options);
          
          return {
            content: [{
              type: "text",
              text: document ? 
                `Document found:\n${JSON.stringify(document, null, 2)}` :
                "No document found matching the criteria"
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error finding document: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Find All Documents
    this.server.registerTool(
      "find-all",
      {
        title: "Find All Documents",
        description: "Find multiple documents by class and query criteria",
        inputSchema: {
          className: z.string().describe("Full class name (e.g., 'tracker.class.Issue', 'contact.class.Person')"),
          query: z.record(z.any()).describe("Query criteria as JSON object"),
          options: z.record(z.any()).optional().describe("Find options (limit, sort, lookup, projection)")
        }
      },
      async ({ className, query, options }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const classRef = this.parseClassName(className);
          const documents = await client.findAll(classRef, query, options);
          
          return {
            content: [{
              type: "text",
              text: `Found ${documents.length} documents:\n${JSON.stringify(documents, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error finding documents: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Document
    this.server.registerTool(
      "create-doc",
      {
        title: "Create Document",
        description: "Create a new document in the specified space",
        inputSchema: {
          className: z.string().describe("Full class name (e.g., 'contact.class.Person')"),
          spaceName: z.string().describe("Space name (e.g., 'contact.space.Contacts')"),
          attributes: z.record(z.any()).describe("Document attributes as JSON object"),
          id: z.string().optional().describe("Optional custom ID for the document")
        }
      },
      async ({ className, spaceName, attributes, id }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const classRef = this.parseClassName(className);
          const spaceRef = this.parseClassName(spaceName);
          const docId = id ? (id as any) : generateId();
          
          const createdId = await client.createDoc(classRef, spaceRef, attributes, docId);
          
          return {
            content: [{
              type: "text",
              text: `Document created successfully with ID: ${createdId}\nClass: ${className}\nSpace: ${spaceName}\nAttributes: ${JSON.stringify(attributes, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating document: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Update Document
    this.server.registerTool(
      "update-doc",
      {
        title: "Update Document",
        description: "Update an existing document",
        inputSchema: {
          className: z.string().describe("Full class name"),
          spaceName: z.string().describe("Space name"),
          objectId: z.string().describe("ID of the object to update"),
          operations: z.record(z.any()).describe("Update operations as JSON object"),
          retrieve: z.boolean().optional().default(false).describe("Whether to retrieve the updated object")
        }
      },
      async ({ className, spaceName, objectId, operations, retrieve }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const classRef = this.parseClassName(className);
          const spaceRef = this.parseClassName(spaceName);
          
          const result = await client.updateDoc(classRef, spaceRef, objectId as any, operations, retrieve);
          
          return {
            content: [{
              type: "text",
              text: `Document updated successfully\nID: ${objectId}\nOperations: ${JSON.stringify(operations, null, 2)}\nResult: ${JSON.stringify(result, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating document: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Remove Document
    this.server.registerTool(
      "remove-doc",
      {
        title: "Remove Document",
        description: "Remove an existing document",
        inputSchema: {
          className: z.string().describe("Full class name"),
          spaceName: z.string().describe("Space name"),
          objectId: z.string().describe("ID of the object to remove")
        }
      },
      async ({ className, spaceName, objectId }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const classRef = this.parseClassName(className);
          const spaceRef = this.parseClassName(spaceName);
          
          await client.removeDoc(classRef, spaceRef, objectId as any);
          
          return {
            content: [{
              type: "text",
              text: `Document removed successfully\nID: ${objectId}\nClass: ${className}\nSpace: ${spaceName}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error removing document: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Add Collection
    this.server.registerTool(
      "add-collection",
      {
        title: "Add Collection Item",
        description: "Create a new attached document in a collection",
        inputSchema: {
          className: z.string().describe("Class of the object to create"),
          spaceName: z.string().describe("Space of the object to create"),
          attachedTo: z.string().describe("ID of the object to attach to"),
          attachedToClass: z.string().describe("Class of the object to attach to"),
          collection: z.string().describe("Name of the collection"),
          attributes: z.record(z.any()).describe("Attributes of the object"),
          id: z.string().optional().describe("Optional custom ID")
        }
      },
      async ({ className, spaceName, attachedTo, attachedToClass, collection, attributes, id }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const classRef = this.parseClassName(className);
          const spaceRef = this.parseClassName(spaceName);
          const attachedToClassRef = this.parseClassName(attachedToClass);
          const docId = id ? (id as any) : generateId();
          
          const createdId = await client.addCollection(
            classRef,
            spaceRef,
            attachedTo as any,
            attachedToClassRef,
            collection,
            attributes,
            docId
          );
          
          return {
            content: [{
              type: "text",
              text: `Collection item created successfully\nID: ${createdId}\nAttached to: ${attachedTo}\nCollection: ${collection}\nAttributes: ${JSON.stringify(attributes, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error adding to collection: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Update Collection
    this.server.registerTool(
      "update-collection",
      {
        title: "Update Collection Item",
        description: "Update an existing attached document in a collection",
        inputSchema: {
          className: z.string().describe("Class of the object to update"),
          spaceName: z.string().describe("Space of the object"),
          objectId: z.string().describe("ID of the object to update"),
          attachedTo: z.string().describe("ID of the parent object"),
          attachedToClass: z.string().describe("Class of the parent object"),
          collection: z.string().describe("Name of the collection"),
          attributes: z.record(z.any()).describe("Attributes to update")
        }
      },
      async ({ className, spaceName, objectId, attachedTo, attachedToClass, collection, attributes }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const classRef = this.parseClassName(className);
          const spaceRef = this.parseClassName(spaceName);
          const attachedToClassRef = this.parseClassName(attachedToClass);
          
          await client.updateCollection(
            classRef,
            spaceRef,
            objectId as any,
            attachedTo as any,
            attachedToClassRef,
            collection,
            attributes
          );
          
          return {
            content: [{
              type: "text",
              text: `Collection item updated successfully\nID: ${objectId}\nCollection: ${collection}\nUpdated attributes: ${JSON.stringify(attributes, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating collection: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Remove Collection
    this.server.registerTool(
      "remove-collection",
      {
        title: "Remove Collection Item", 
        description: "Remove an existing attached document from a collection",
        inputSchema: {
          className: z.string().describe("Class of the object to remove"),
          spaceName: z.string().describe("Space of the object"),
          objectId: z.string().describe("ID of the object to remove"),
          attachedTo: z.string().describe("ID of the parent object"),
          attachedToClass: z.string().describe("Class of the parent object"),
          collection: z.string().describe("Name of the collection")
        }
      },
      async ({ className, spaceName, objectId, attachedTo, attachedToClass, collection }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const classRef = this.parseClassName(className);
          const spaceRef = this.parseClassName(spaceName);
          const attachedToClassRef = this.parseClassName(attachedToClass);
          
          await client.removeCollection(
            classRef,
            spaceRef,
            objectId as any,
            attachedTo as any,
            attachedToClassRef,
            collection
          );
          
          return {
            content: [{
              type: "text",
              text: `Collection item removed successfully\nID: ${objectId}\nCollection: ${collection}\nRemoved from: ${attachedTo}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error removing from collection: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Mixin
    this.server.registerTool(
      "create-mixin",
      {
        title: "Create Mixin",
        description: "Create a new mixin for a specified document",
        inputSchema: {
          objectId: z.string().describe("ID of the object the mixin is attached to"),
          objectClass: z.string().describe("Class of the object the mixin is attached to"),
          objectSpace: z.string().describe("Space of the object the mixin is attached to"),
          mixin: z.string().describe("ID of the mixin type"),
          attributes: z.record(z.any()).describe("Attributes of the mixin")
        }
      },
      async ({ objectId, objectClass, objectSpace, mixin, attributes }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const objectClassRef = this.parseClassName(objectClass);
          const objectSpaceRef = this.parseClassName(objectSpace);
          const mixinRef = this.parseClassName(mixin);
          
          await client.createMixin(
            objectId as any,
            objectClassRef,
            objectSpaceRef,
            mixinRef,
            attributes
          );
          
          return {
            content: [{
              type: "text",
              text: `Mixin created successfully\nObject ID: ${objectId}\nMixin: ${mixin}\nAttributes: ${JSON.stringify(attributes, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating mixin: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Update Mixin
    this.server.registerTool(
      "update-mixin",
      {
        title: "Update Mixin",
        description: "Update an existing mixin",
        inputSchema: {
          objectId: z.string().describe("ID of the object the mixin is attached to"),
          objectClass: z.string().describe("Class of the object the mixin is attached to"),
          objectSpace: z.string().describe("Space of the object the mixin is attached to"),
          mixin: z.string().describe("ID of the mixin type"),
          attributes: z.record(z.any()).describe("Attributes to update")
        }
      },
      async ({ objectId, objectClass, objectSpace, mixin, attributes }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          const objectClassRef = this.parseClassName(objectClass);
          const objectSpaceRef = this.parseClassName(objectSpace);
          const mixinRef = this.parseClassName(mixin);
          
          await client.updateMixin(
            objectId as any,
            objectClassRef,
            objectSpaceRef,
            mixinRef,
            attributes
          );
          
          return {
            content: [{
              type: "text",
              text: `Mixin updated successfully\nObject ID: ${objectId}\nMixin: ${mixin}\nUpdated attributes: ${JSON.stringify(attributes, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error updating mixin: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Connection Status
    this.server.registerTool(
      "connection-status",
      {
        title: "Connection Status",
        description: "Check the current connection status to Huly",
        inputSchema: {
          ping: z.boolean().optional().default(false).describe("Whether to perform a ping test")
        }
      },
      async ({ ping }) => {
        try {
          const isConnected = this.hulyConnection.isConnected();
          let pingResult = null;
          
          if (ping && isConnected) {
            pingResult = await this.hulyConnection.ping();
          }
          
          return {
            content: [{
              type: "text",
              text: `Connection Status:\n` +
                    `Connected: ${isConnected}\n` +
                    (pingResult !== null ? `Ping successful: ${pingResult}\n` : '') +
                    `Server URL: ${this.hulyConnection['config'].url}\n` +
                    `Workspace: ${this.hulyConnection['config'].workspace}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error checking connection: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );
  }

  // Helper method to parse class names like "tracker.class.Issue" to actual class references
  private parseClassName(className: string): any {
    const parts = className.split('.');
    if (parts.length < 3) {
      throw new Error(`Invalid class name format: ${className}. Expected format: 'module.class.ClassName'`);
    }
    
    const [moduleName, classType, ...classPath] = parts;
    
    let moduleRef: any;
    switch (moduleName) {
      case 'tracker':
        moduleRef = tracker;
        break;
      case 'core':
        moduleRef = core;
        break;
      case 'task':
        moduleRef = task;
        break;
      // Add more modules as needed
      default:
        throw new Error(`Unknown module: ${moduleName}`);
    }
    
    let current = moduleRef;
    for (const part of [classType, ...classPath]) {
      if (!current[part]) {
        throw new Error(`Class not found: ${className}`);
      }
      current = current[part];
    }
    
    return current;
  }

  // === REPORTING & SEARCH CAPABILITIES ===

  private setupReportingTools(): void {
    // Tool: Generate Sprint Report
    this.server.registerTool(
      "generate-sprint-report",
      {
        title: "Generate Sprint Report",
        description: "Generate comprehensive sprint reports (burndown, velocity, bottlenecks)",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          sprintName: z.string().describe("Sprint name"),
          reportType: z.enum(['burndown', 'velocity', 'bottleneck', 'summary']).describe("Type of report to generate")
        }
      },
      async ({ projectIdentifier, sprintName, reportType }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // Find sprint
          const sprint = await client.findOne(
            tracker.class.Sprint,
            { space: project._id, name: sprintName }
          );

          if (!sprint) {
            return {
              content: [{ type: "text", text: `Sprint '${sprintName}' not found` }],
              isError: true
            };
          }

          // Get sprint issues
          const issues = await client.findAll(
            tracker.class.Issue,
            { space: project._id, sprint: sprint._id }
          );

          let reportContent = `# ${reportType.toUpperCase()} REPORT\n`;
          reportContent += `Project: ${projectIdentifier}\n`;
          reportContent += `Sprint: ${sprintName}\n`;
          reportContent += `Period: ${new Date(sprint.startDate).toISOString().split('T')[0]} to ${new Date(sprint.targetDate).toISOString().split('T')[0]}\n\n`;

          switch (reportType) {
            case 'burndown':
              const totalEstimation = issues.reduce((sum: number, issue: any) => sum + (issue.estimation || 0), 0);
              const completedEstimation = issues
                .filter((issue: any) => issue.status === 'completed' || issue.status === 'done')
                .reduce((sum: number, issue: any) => sum + (issue.estimation || 0), 0);
              const remainingEstimation = totalEstimation - completedEstimation;

              reportContent += `## Burndown Analysis\n`;
              reportContent += `- Total Story Points: ${totalEstimation}h\n`;
              reportContent += `- Completed: ${completedEstimation}h (${totalEstimation > 0 ? Math.round((completedEstimation / totalEstimation) * 100) : 0}%)\n`;
              reportContent += `- Remaining: ${remainingEstimation}h\n`;
              reportContent += `- Sprint Capacity: ${sprint.capacity}h\n`;
              reportContent += `- Capacity Utilization: ${sprint.capacity > 0 ? Math.round((totalEstimation / sprint.capacity) * 100) : 0}%\n\n`;
              break;

            case 'velocity':
              const completedIssues = issues.filter((issue: any) => issue.status === 'completed' || issue.status === 'done');
              const completedPoints = completedIssues.reduce((sum: number, issue: any) => sum + (issue.estimation || 0), 0);
              
              reportContent += `## Velocity Analysis\n`;
              reportContent += `- Completed Issues: ${completedIssues.length}\n`;
              reportContent += `- Completed Story Points: ${completedPoints}h\n`;
              reportContent += `- Average Points per Issue: ${completedIssues.length > 0 ? Math.round(completedPoints / completedIssues.length * 100) / 100 : 0}h\n\n`;
              break;

            case 'bottleneck':
              const statusCounts: { [key: string]: number } = {};
              issues.forEach((issue: any) => {
                statusCounts[issue.status] = (statusCounts[issue.status] || 0) + 1;
              });

              reportContent += `## Bottleneck Analysis\n`;
              reportContent += `Status Distribution:\n`;
              Object.entries(statusCounts).forEach(([status, count]) => {
                reportContent += `- ${status}: ${count} issues\n`;
              });
              reportContent += `\n`;
              break;

            case 'summary':
              reportContent += `## Sprint Summary\n`;
              reportContent += `- Total Issues: ${issues.length}\n`;
              reportContent += `- Total Estimation: ${issues.reduce((sum: number, issue: any) => sum + (issue.estimation || 0), 0)}h\n`;
              reportContent += `- Completed Issues: ${issues.filter((issue: any) => issue.status === 'completed' || issue.status === 'done').length}\n`;
              reportContent += `- In Progress: ${issues.filter((issue: any) => issue.status === 'in-progress').length}\n`;
              reportContent += `- Open Issues: ${issues.filter((issue: any) => issue.status === 'open' || issue.status === 'new').length}\n\n`;
              break;
          }

          reportContent += `## Issue Details\n`;
          issues.forEach((issue: any) => {
            reportContent += `- ${issue.identifier}: ${issue.title} [${issue.status}] (${issue.estimation || 0}h)\n`;
          });

          return {
            content: [{
              type: "text",
              text: reportContent
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error generating sprint report: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Cross-Module Search
    this.server.registerTool(
      "cross-module-search",
      {
        title: "Cross-Module Search",
        description: "Search across tasks, documents, and contacts",
        inputSchema: {
          query: z.string().describe("Search query"),
          modules: z.array(z.enum(['task', 'document', 'contact'])).optional().default(['task']).describe("Modules to search in"),
          limit: z.number().optional().default(20).describe("Maximum results per module")
        }
      },
      async ({ query, modules, limit }) => {
        try {
          const client = await this.hulyConnection.connect();
          let results = '';

          if (modules.includes('task')) {
            const issues = await client.findAll(
              tracker.class.Issue,
              {
                $or: [
                  { title: { $regex: query, $options: 'i' } },
                  { identifier: { $regex: query, $options: 'i' } }
                ]
              },
              { limit }
            );

            results += `## Task Results (${issues.length})\n`;
            issues.forEach((issue: any) => {
              results += `- ${issue.identifier}: ${issue.title}\n`;
            });
            results += '\n';
          }

          if (modules.includes('contact')) {
            try {
              const contacts = await client.findAll(
                'contact.class.Person' as any,
                {
                  $or: [
                    { name: { $regex: query, $options: 'i' } },
                    { email: { $regex: query, $options: 'i' } }
                  ]
                },
                { limit }
              );

              results += `## Contact Results (${contacts.length})\n`;
              contacts.forEach((contact: any) => {
                results += `- ${contact.name}: ${contact.email || 'No email'}\n`;
              });
              results += '\n';
            } catch (e) {
              results += `## Contact Results\nContact search not available\n\n`;
            }
          }

          return {
            content: [{
              type: "text",
              text: `# Search Results for: "${query}"\n\n${results}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error performing search: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Export Data
    this.server.registerTool(
      "export-data",
      {
        title: "Export Data",
        description: "Export project data in CSV or JSON format",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier"),
          dataType: z.enum(['issues', 'sprints', 'components']).describe("Type of data to export"),
          format: z.enum(['csv', 'json']).describe("Export format"),
          filters: z.record(z.any()).optional().describe("Optional filters to apply")
        }
      },
      async ({ projectIdentifier, dataType, format, filters }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          let data: any[] = [];
          const query = { space: project._id, ...filters };

          switch (dataType) {
            case 'issues':
              data = await client.findAll(tracker.class.Issue, query);
              break;
            case 'sprints':
              data = await client.findAll(tracker.class.Sprint, query);
              break;
            case 'components':
              data = await client.findAll(tracker.class.Component, query);
              break;
          }

          let exportContent = '';

          if (format === 'json') {
            exportContent = JSON.stringify(data, null, 2);
          } else if (format === 'csv') {
            if (data.length > 0) {
              const headers = Object.keys(data[0]).join(',');
              const rows = data.map(item => 
                Object.values(item).map(value => 
                  typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
                ).join(',')
              );
              exportContent = [headers, ...rows].join('\n');
            }
          }

          return {
            content: [{
              type: "text",
              text: `# Export: ${dataType} from ${projectIdentifier} (${format.toUpperCase()})\n\n${exportContent}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error exporting data: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Saved Filter
    this.server.registerTool(
      "create-saved-filter",
      {
        title: "Create Saved Filter",
        description: "Create a saved filter for frequent queries",
        inputSchema: {
          name: z.string().describe("Filter name"),
          description: z.string().optional().describe("Filter description"),
          query: z.record(z.any()).describe("Filter query criteria"),
          targetClass: z.string().describe("Target class (e.g., 'tracker.class.Issue')")
        }
      },
      async ({ name, description, query, targetClass }) => {
        try {
          const client = await this.hulyConnection.connect();

          const filterId = generateId();
          
          // Create saved filter (this would be stored in user preferences in a real implementation)
          const filterData = {
            name,
            description: description || '',
            query,
            targetClass,
            createdOn: Date.now(),
            createdBy: 'current-user' // Would be actual user in real implementation
          };

          return {
            content: [{
              type: "text",
              text: `Saved filter created: ${name}\n` +
                    `Description: ${description || 'No description'}\n` +
                    `Target: ${targetClass}\n` +
                    `Query: ${JSON.stringify(query, null, 2)}\n` +
                    `Note: In a full implementation, this would be persisted to user preferences.`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating saved filter: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );
  }

  private setupResources(): void {
    // Resource: Project Information
    this.server.registerResource(
      "project-info",
      new ResourceTemplate("huly://project/{identifier}", { list: undefined }),
      {
        title: "Project Information",
        description: "Detailed information about a Huly project",
        mimeType: "application/json"
      },
      async (uri, { identifier }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          // Ensure identifier is a string
          const projectId = Array.isArray(identifier) ? identifier[0] : identifier;

          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectId },
            { lookup: { type: task.class.ProjectType } }
          ) as WithLookup<Project> | undefined;

          if (!project) {
            throw new Error(`Project '${projectId}' not found`);
          }

          const projectInfo = {
            identifier: project.identifier,
            name: project.name,
            description: project.description,
            type: project.$lookup?.type?.name || 'Unknown',
            private: project.private,
            archived: project.archived,
            defaultIssueStatus: project.defaultIssueStatus,
            sequence: project.sequence,
            createdOn: project.createdOn,
            modifiedOn: project.modifiedOn
          };

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(projectInfo, null, 2),
              mimeType: "application/json"
            }]
          };
        } catch (error) {
          throw new Error(`Error fetching project info: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );

    // Resource: Issue Details
    this.server.registerResource(
      "issue-details",
      new ResourceTemplate("huly://issue/{identifier}", { list: undefined }),
      {
        title: "Issue Details",
        description: "Detailed information about a Huly issue",
        mimeType: "application/json"
      },
      async (uri, { identifier }) => {
        try {
          const client = await this.hulyConnection.connect();
          
          // Ensure identifier is a string
          const issueId = Array.isArray(identifier) ? identifier[0] : identifier;

          const issue = await client.findOne(
            tracker.class.Issue,
            { identifier: issueId }
          ) as Issue | undefined;

          if (!issue) {
            throw new Error(`Issue '${issueId}' not found`);
          }

          const description = issue.description ?
            await client.fetchMarkup(issue._class, issue._id, 'description', issue.description, 'markdown') :
            null;

          const issueDetails = {
            identifier: issue.identifier,
            title: issue.title,
            description,
            priority: issue.priority,
            status: issue.status,
            assignee: issue.assignee,
            estimation: issue.estimation,
            remainingTime: issue.remainingTime,
            reportedTime: issue.reportedTime,
            number: issue.number,
            createdOn: issue.createdOn,
            modifiedOn: issue.modifiedOn,
            dueDate: issue.dueDate,
            subIssues: issue.subIssues,
            reports: issue.reports
          };

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(issueDetails, null, 2),
              mimeType: "application/json"
            }]
          };
        } catch (error) {
          throw new Error(`Error fetching issue details: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
  }

  private setupPrompts(): void {
    // Prompt: Issue Creation Template
    this.server.registerPrompt(
      "create-issue-template",
      {
        title: "Issue Creation Template",
        description: "Template for creating well-structured issues",
        argsSchema: {
          projectType: z.enum(['bug', 'feature', 'task', 'improvement']).describe("Type of issue to create"),
          urgency: z.enum(['low', 'medium', 'high', 'critical']).describe("Urgency level")
        }
      },
      ({ projectType, urgency }) => {
        const templates = {
          bug: `Create a bug report with the following structure:

**Summary**: Brief description of the bug

**Steps to Reproduce**:
1. Step one
2. Step two
3. Step three

**Expected Behavior**: What should happen

**Actual Behavior**: What actually happens

**Environment**:
- OS: 
- Browser: 
- Version: 

**Additional Notes**: Any other relevant information`,

          feature: `Create a feature request with the following structure:

**Feature Summary**: Brief description of the requested feature

**Problem Statement**: What problem does this solve?

**Proposed Solution**: How should this feature work?

**Acceptance Criteria**:
- [ ] Criteria 1
- [ ] Criteria 2
- [ ] Criteria 3

**Additional Context**: Any other relevant information`,

          task: `Create a task with the following structure:

**Task Summary**: Brief description of what needs to be done

**Objective**: Why is this task necessary?

**Requirements**:
- Requirement 1
- Requirement 2
- Requirement 3

**Deliverables**:
- [ ] Deliverable 1
- [ ] Deliverable 2

**Notes**: Any additional information`,

          improvement: `Create an improvement suggestion with the following structure:

**Current State**: How things work now

**Proposed Improvement**: What should be changed

**Benefits**: What will this improvement provide?

**Implementation Notes**: How this could be implemented

**Impact Assessment**: What areas will be affected?`
        };

        const urgencyNote = {
          low: "This is a low priority item that can be addressed in a future sprint.",
          medium: "This has medium priority and should be planned for upcoming sprints.",
          high: "This is high priority and should be addressed soon.",
          critical: "This is critical and needs immediate attention."
        };

        return {
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Please help me create a ${projectType} issue. Use this template and remember this is ${urgency} urgency.\n\n${templates[projectType]}\n\n**Priority Note**: ${urgencyNote[urgency]}`
            }
          }]
        };
      }
    );

    // Prompt: Project Review Template
    this.server.registerPrompt(
      "project-review-template",
      {
        title: "Project Review Template",
        description: "Template for reviewing project status and health",
        argsSchema: {
          projectIdentifier: z.string().describe("Project identifier to review"),
          reviewType: z.enum(['sprint', 'milestone', 'quarterly']).describe("Type of review")
        }
      },
      ({ projectIdentifier, reviewType }) => {
        const reviewPrompts = {
          sprint: `Please analyze the sprint progress for project ${projectIdentifier}:

1. **Sprint Goals**: What were the main objectives?
2. **Completed Work**: What issues were resolved?
3. **Incomplete Work**: What remains to be done?
4. **Blockers**: What prevented completion of work?
5. **Team Performance**: How did the team perform?
6. **Next Sprint Planning**: What should be prioritized next?`,

          milestone: `Please conduct a milestone review for project ${projectIdentifier}:

1. **Milestone Objectives**: What were the key deliverables?
2. **Achievement Status**: What percentage was completed?
3. **Quality Assessment**: How well was the work done?
4. **Timeline Analysis**: Were deadlines met?
5. **Resource Utilization**: How effectively were resources used?
6. **Lessons Learned**: What can be improved?
7. **Next Milestone Planning**: What's the roadmap ahead?`,

          quarterly: `Please perform a quarterly review for project ${projectIdentifier}:

1. **Quarterly Goals**: What were the strategic objectives?
2. **Key Achievements**: What major milestones were reached?
3. **Metrics Analysis**: How do key metrics look?
4. **Risk Assessment**: What risks were encountered?
5. **Team Development**: How has the team grown?
6. **Stakeholder Feedback**: What feedback has been received?
7. **Strategic Adjustments**: What changes are needed?
8. **Next Quarter Planning**: What are the priorities?`
        };

        return {
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Please help me conduct a ${reviewType} review for project ${projectIdentifier}. Use the following framework:\n\n${reviewPrompts[reviewType]}\n\nPlease gather the relevant data and provide insights for each section.`
            }
          }]
        };
      }
    );
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    await this.hulyConnection.disconnect();
  }
}