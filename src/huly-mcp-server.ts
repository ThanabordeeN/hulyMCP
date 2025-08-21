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
const core = corePkg;
const tracker = trackerPkg;
const task = taskPkg;

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
          ) as Issue[];

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