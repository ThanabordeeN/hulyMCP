import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HulyConnection } from "./huly-connection.js";
import { HulyConfig } from "./config.js";

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
          const issueId: Ref<Issue> = generateId();

          // Generate next issue number
          const incResult = await client.updateDoc(
            tracker.class.Project,
            core.space.Space as Ref<any>,
            project._id,
            { $inc: { sequence: 1 } },
            true
          );

          const sequence = (incResult as any).object.sequence;

          // Get rank for ordering
          const lastOne = await client.findOne<Issue>(
            tracker.class.Issue,
            { space: project._id },
            { sort: { rank: SortingOrder.Descending } }
          );

          // Upload description if provided
          let descriptionRef: any = null;
          if (description) {
            descriptionRef = await client.uploadMarkup(
              tracker.class.Issue, 
              issueId, 
              'description', 
              description, 
              'markdown'
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