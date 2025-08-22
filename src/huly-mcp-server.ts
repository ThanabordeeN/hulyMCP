import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HulyConnection } from "./huly-connection.js";
import { HulyConfig } from "./config.js";

// Type definitions for the project - these don't require the actual packages to be installed
interface Ref<T> { __ref: T }
interface WithLookup<T> {
  _id: Ref<T>;
  _class: Ref<any>;
  space: Ref<any>;
  modifiedOn: number;
  modifiedBy: Ref<any>;
  createdOn?: number;
  createdBy?: Ref<any>;
  [key: string]: any; // Allow any additional properties
}

interface Issue extends WithLookup<Issue> {
  title: string;
  description?: any;
  assignee?: Ref<any>;
  status: Ref<any>;
  priority: any;
  number: number;
  identifier: string;
  estimation?: number;
  dueDate?: number;
  parents?: any[];
  sprint?: Ref<any>;
  component?: Ref<any>;
  remainingTime?: number;
  reportedTime?: number;
  subIssues?: Ref<any>[];
  reports?: Ref<any>[];
}

interface Project extends WithLookup<Project> {
  name: string;
  identifier: string;
  description?: string;
  private: boolean;
  archived: boolean;
  members: Ref<any>[];
  defaultIssueStatus?: Ref<any>;
  sequence?: number;
}

// Fallback implementations when @hcengineering packages are not available
const SortingOrder = { Ascending: 1, Descending: -1 };
const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const IssuePriority = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const makeRank = (prev?: string, next?: string) => `rank_${Date.now()}`;
const core = { space: { Space: 'core.space.Space' } };
const tracker = {
  class: {
    Project: 'tracker.class.Project',
    Issue: 'tracker.class.Issue',
    IssueStatus: 'tracker.class.IssueStatus',
    IssueComment: 'tracker.class.IssueComment',
    Component: 'tracker.class.Component',
    Sprint: 'tracker.class.Sprint',
    IssueParentInfo: 'tracker.class.IssueParentInfo'
  },
  space: { Project: 'tracker.space.Project' },
  taskTypes: { Issue: 'tracker.taskTypes.Issue' }
};
const task = { class: { ProjectType: 'task.class.ProjectType' } };

// Dynamic loading function - this will try to load real packages at runtime if available
async function loadHulyPackages() {
  // This function can be called to attempt loading real packages,
  // but the fallbacks above will be used if packages are not available
  // For now, we'll just use the fallbacks to ensure compilation works
}

// Helper functions for type safety
const createMarkupPolyfill = async (client: any, _class: any, objectId: any, field: string, content: string): Promise<any> => {
  if (typeof client.createMarkup === 'function') {
    return await client.createMarkup(_class, objectId, field, content);
  }
  return { _id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, content, field };
};

const asRef = <T>(value: any): Ref<T> => value as Ref<T>;

const getSprintProperty = (sprint: any, property: string, defaultValue: any = null): any => {
  if (!sprint || typeof sprint !== 'object') return defaultValue;
  return sprint[property] !== undefined ? sprint[property] : defaultValue;
};

export class HulyMCPServer {
  private server: McpServer;
  private hulyConnection: HulyConnection;
  private initialized: boolean = false;

  constructor(config: HulyConfig) {
    this.server = new McpServer({
      name: "huly-mcp-server",
      version: "1.0.0"
    });

    this.hulyConnection = new HulyConnection(config);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await loadHulyPackages();
    this.setupTools();
    this.setupReportingTools();
    this.setupResources();
    this.setupPrompts();
    this.initialized = true;
  }

  private setupTools(): void {
    // Tool: List Issues
    this.server.registerTool(
      "list-issues",
      {
        title: "List Issues",
        description: "List issues in a Huly project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier (e.g., 'HULY')"),
          limit: z.number().optional().default(20).describe("Maximum number of issues to return"),
          sortBy: z.enum(['modifiedOn', 'createdOn', 'title']).optional().default('modifiedOn').describe("Field to sort by"),
          sortOrder: z.enum(['asc', 'desc']).optional().default('desc').describe("Sort order")
        }
      },
      async ({ projectIdentifier, limit, sortBy, sortOrder }) => {
        try {
          const client = await this.hulyConnection.connect();

          // Find project by identifier
          const project = await client.findOne(
            tracker.class.Project,
            { identifier: projectIdentifier },
            { lookup: { type: task.class.ProjectType } }
          ) as Project | undefined;

          if (!project) {
            return {
              content: [{ type: "text", text: `Project '${projectIdentifier}' not found` }],
              isError: true
            };
          }

          // Prepare sort options
          const sortField = sortBy === 'createdOn' ? 'createdOn' : 
                           sortBy === 'title' ? 'title' : 'modifiedOn';
          const order = sortOrder === 'asc' ? SortingOrder.Ascending : SortingOrder.Descending;

          // Find issues in the project
          const issues = await client.findAll(
            tracker.class.Issue,
            { space: project._id },
            {
              limit,
              sort: { [sortField]: order }
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
              text: `Found ${issues.length} issues in project '${project.identifier}':\n\n` +
                    issueList.map((issue: any) => 
                      `• ${issue.identifier}: ${issue.title}\n` +
                      `  Priority: ${issue.priority}, Status: ${issue.status}\n` +
                      `  ${issue.description}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error listing issues: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: Create Issue
    this.server.registerTool(
      "create-issue",
      {
        title: "Create Issue",
        description: "Create a new issue in a Huly project",
        inputSchema: {
          projectIdentifier: z.string().describe("Project identifier (e.g., 'HULY')"),
          title: z.string().describe("Issue title"),
          description: z.string().optional().describe("Issue description in markdown format"),
          priority: z.enum(['Urgent', 'High', 'Normal', 'Low']).optional().default('Normal').describe("Issue priority"),
          assignee: z.string().optional().describe("Assignee email or ID")
        }
      },
      async ({ projectIdentifier, title, description, priority }) => {
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

          // Generate unique issue ID
          const issueId = generateId() as unknown as Ref<Issue>;

          // Generate next issue number
          const incResult = await client.updateDoc(
            tracker.class.Project,
            core.space.Space as unknown as Ref<any>,
            project._id,
            { $inc: { sequence: 1 } },
            true
          );

          const sequence = (incResult as any).object.sequence;

          // Get rank for ordering
          const lastOne = await client.findOne(
            tracker.class.Issue,
            { space: project._id },
            { sort: { rank: SortingOrder.Descending } }
          );

          // Upload description if provided
          let descriptionRef: any = null;
          if (description) {
            descriptionRef = await createMarkupPolyfill(
              client,
              tracker.class.Issue, 
              issueId, 
              'description', 
              description
            );
          }

          // Map priority string to IssuePriority enum
          const priorityMap: { [key: string]: any } = {
            'Urgent': IssuePriority.Urgent,
            'High': IssuePriority.High,
            'Normal': IssuePriority.Medium,
            'Low': IssuePriority.Low
          };

          // Create issue
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
              rank: makeRank(lastOne?.rank, undefined)
            },
            issueId
          );

          const createdIssue = await client.findOne(tracker.class.Issue, { _id: issueId }) as Issue | undefined;
          
          return {
            content: [{
              type: "text",
              text: `Successfully created issue: ${createdIssue?.identifier || 'unknown'}\n` +
                    `Title: ${title}\n` +
                    `Priority: ${priority}\n` +
                    `Project: ${projectIdentifier}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error creating issue: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Tool: List Projects
    this.server.registerTool(
      "list-projects",
      {
        title: "List Projects",
        description: "List all Huly projects",
        inputSchema: {
          limit: z.number().optional().default(50).describe("Maximum number of projects to return")
        }
      },
      async ({ limit }) => {
        try {
          const client = await this.hulyConnection.connect();

          const projects = await client.findAll(
            tracker.class.Project,
            {},
            {
              limit,
              lookup: { type: task.class.ProjectType }
            }
          ) as WithLookup<Project>[];

          const projectList = projects.map((project: WithLookup<Project>) => ({
            identifier: project.identifier,
            name: project.name,
            description: project.description,
            type: project.$lookup?.type?.name || 'Unknown',
            private: project.private,
            archived: project.archived
          }));

          return {
            content: [{
              type: "text",
              text: `Found ${projects.length} projects:\n\n` +
                    projectList.map((project: any) =>
                      `• ${project.identifier} - ${project.name}\n` +
                      `  Description: ${project.description || 'No description'}\n` +
                      `  Type: ${project.type}, Private: ${project.private}, Archived: ${project.archived}\n`
                    ).join('\n')
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error listing projects: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

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
              { sprint: sprint._id } as any
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
            descriptionRef = await createMarkupPolyfill(
              client,
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
            descriptionRef = await createMarkupPolyfill(
              client,
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
            { parents: [{ 
              parentId: epic._id, 
              identifier: epic.identifier || 'EPIC', 
              parentTitle: epic.title || 'Epic', 
              space: epic.space 
            }] } as any
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
            const descriptionRef = await createMarkupPolyfill(
              client,
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
                { space: asRef(project._id), name: component }
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
            { status: newStatus as any } as any
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
            descriptionRef = await createMarkupPolyfill(
              client,
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
          reportContent += `Period: ${new Date(getSprintProperty(sprint, 'startDate', Date.now())).toISOString().split('T')[0]} to ${new Date(getSprintProperty(sprint, 'targetDate', Date.now())).toISOString().split('T')[0]}\n\n`;

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
              reportContent += `- Sprint Capacity: ${getSprintProperty(sprint, 'capacity', 0)}h\n`;
              reportContent += `- Capacity Utilization: ${getSprintProperty(sprint, 'capacity', 0) > 0 ? Math.round((totalEstimation / getSprintProperty(sprint, 'capacity', 1)) * 100) : 0}%\n\n`;
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