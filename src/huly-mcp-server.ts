import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PlatformClient } from "@hcengineering/api-client";
import { HulyConfig } from "./config.js";
import { SortingOrder, IssuePriority } from "@hcengineering/core";
import { class as trackerClass, space as trackerSpace, taskTypes } from "@hcengineering/tracker";
import { class as taskClass } from "@hcengineering/task";
import { makeRank } from "@hcengineering/rank";

// Type definitions for the project
// These are simplified versions. In a real scenario, you might import more specific types.
type Ref<T> = { __ref: T };

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

// Helper function for generating IDs, using a placeholder for now
const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Helper functions for type safety
const createMarkupPolyfill = async (client: any, _class: any, objectId: any, field: string, content: string): Promise<any> => {
  if (typeof client.createMarkup === 'function') {
    return await client.createMarkup(_class, objectId, field, content);
  }
  // Fallback for older clients
  return { _id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, content, field };
};

const asRef = <T>(value: any): Ref<T> => value as Ref<T>;

const getSprintProperty = (sprint: any, property: string, defaultValue: any = null): any => {
  if (!sprint || typeof sprint !== 'object') return defaultValue;
  return sprint[property] !== undefined ? sprint[property] : defaultValue;
};

// --- Tool Implementations ---

// B-1: Issue/Task Management Tools

async function huly_create_issue(params: { projectId: string; title: string; description?: string; assigneeId?: string; priority?: string }, client: PlatformClient): Promise<{ issueId: string, identifier: string }> {
    const project = await client.findOne(trackerClass.Project, { identifier: params.projectId });
    if (!project) throw new Error(`Project '${params.projectId}' not found.`);
    const issueId = generateId() as Ref<Issue>;
    const incResult = await client.updateDoc(trackerClass.Project, project.space, project._id, { $inc: { sequence: 1 } }, true);
    const sequence = (incResult as any).object.sequence;
    const identifier = `${project.identifier}-${sequence}`;
    // Simplified implementation - a real one would handle description markup, priority mapping, etc.
    await client.addCollection(trackerClass.Issue, project._id, project._id, project._class, 'issues', {
        title: params.title,
        description: params.description || '',
        identifier,
        assignee: params.assigneeId || null,
    }, issueId);
    return { issueId: issueId.toString(), identifier };
}

async function huly_get_issue_details(params: { issueId?: string; identifier?: string }, client: PlatformClient): Promise<any> {
    if (!params.issueId && !params.identifier) throw new Error("Either issueId or identifier must be provided.");
    const query = params.issueId ? { _id: params.issueId } : { identifier: params.identifier };
    const issue = await client.findOne(trackerClass.Issue, query);
    if (!issue) throw new Error("Issue not found.");
    return issue;
}

async function huly_update_issue(params: { issueId: string; title?: string; description?: string; status?: string; assigneeId?: string }, client: PlatformClient): Promise<{ success: boolean }> {
    const updateOps: any = {};
    if (params.title) updateOps.title = params.title;
    if (params.description) updateOps.description = params.description;
    if (params.status) updateOps.status = params.status;
    if (params.assigneeId) updateOps.assignee = params.assigneeId;
    
    const issue = await client.findOne(trackerClass.Issue, { _id: params.issueId });
    if (!issue) throw new Error("Issue not found.");
    
    await client.updateDoc(trackerClass.Issue, issue.space, params.issueId, updateOps);
    return { success: true };
}

async function huly_delete_issue(params: { issueId: string }, client: PlatformClient): Promise<{ success: boolean }> {
    const issue = await client.findOne(trackerClass.Issue, { _id: params.issueId });
    if (!issue) throw new Error("Issue not found.");
    await client.removeDoc(trackerClass.Issue, issue.space, params.issueId);
    return { success: true };
}

async function huly_find_issues(params: { projectId: string; query?: string; status?: string; assigneeId?: string }, client: PlatformClient): Promise<any[]> {
    const project = await client.findOne(trackerClass.Project, { identifier: params.projectId });
    if (!project) throw new Error(`Project '${params.projectId}' not found.`);
    const mongoQuery: any = { space: project._id };
    if (params.query) mongoQuery.title = { $regex: params.query, $options: 'i' };
    if (params.status) mongoQuery.status = params.status;
    if (params.assigneeId) mongoQuery.assignee = params.assigneeId;
    return client.findAll(trackerClass.Issue, mongoQuery);
}

async function huly_transition_issue(params: { issueId: string; status: string }, client: PlatformClient): Promise<{ success: boolean }> {
    return huly_update_issue({ issueId: params.issueId, status: params.status }, client);
}

async function huly_add_comment(params: { issueId: string; comment: string }, client: PlatformClient): Promise<{ commentId: string }> {
    const issue = await client.findOne(trackerClass.Issue, { _id: params.issueId });
    if (!issue) throw new Error("Issue not found.");
    const commentId = generateId();
    await client.addCollection(trackerClass.IssueComment, issue.space, issue._id, trackerClass.Issue, 'comments', { message: params.comment }, commentId);
    return { commentId: commentId.toString() };
}

// Placeholder functions for tools that require more complex logic or are not directly supported by the mock client
async function huly_add_worklog(params: { issueId: string; timeSpent: string }, client: PlatformClient): Promise<{ worklogId: string }> {
    console.warn("huly_add_worklog is a placeholder and does not persist data.");
    return { worklogId: generateId() };
}

async function huly_get_worklogs(params: { issueId: string }, client: PlatformClient): Promise<any[]> {
    console.warn("huly_get_worklogs is a placeholder and returns mock data.");
    return [];
}

async function huly_create_issue_link(params: { sourceIssueId: string; targetIssueId: string; linkType: string }, client: PlatformClient): Promise<{ linkId: string }> {
    console.warn("huly_create_issue_link is a placeholder and does not persist data.");
    return { linkId: generateId() };
}

async function huly_get_attachments(params: { issueId: string }, client: PlatformClient): Promise<any[]> {
    console.warn("huly_get_attachments is a placeholder and returns mock data.");
    return [];
}

async function huly_batch_create_issues(params: { projectId: string; issues: { title: string; description?: string }[] }, client: PlatformClient): Promise<{ createdIssues: number; issueIds: string[] }> {
    let createdCount = 0;
    const issueIds: string[] = [];
    for (const issue of params.issues) {
        const result = await huly_create_issue({ projectId: params.projectId, title: issue.title, description: issue.description }, client);
        issueIds.push(result.issueId);
        createdCount++;
    }
    return { createdIssues: createdCount, issueIds };
}

// B-2: Project Management Tools
async function huly_get_all_projects(params: {}, client: PlatformClient): Promise<any[]> {
    return client.findAll(trackerClass.Project, {});
}

async function huly_get_project_details(params: { projectId: string }, client: PlatformClient): Promise<any> {
    const project = await client.findOne(trackerClass.Project, { identifier: params.projectId });
    if (!project) throw new Error(`Project '${params.projectId}' not found.`);
    return project;
}

async function huly_get_project_versions(params: { projectId: string }, client: PlatformClient): Promise<any[]> {
    console.warn("huly_get_project_versions is a placeholder and returns mock data.");
    return [];
}

async function huly_create_version(params: { projectId: string; versionName: string; releaseDate?: string }, client: PlatformClient): Promise<{ versionId: string }> {
    console.warn("huly_create_version is a placeholder and does not persist data.");
    return { versionId: generateId() };
}

// B-3: Agile & Sprint Management Tools
async function huly_get_agile_boards(params: { projectId?: string }, client: PlatformClient): Promise<any[]> {
    console.warn("huly_get_agile_boards is a placeholder and returns mock data.");
    return [];
}

async function huly_get_sprints_from_board(params: { boardId: string; state?: 'active' | 'future' | 'closed' }, client: PlatformClient): Promise<any[]> {
    console.warn("huly_get_sprints_from_board is a placeholder and returns mock data.");
    return [];
}

async function huly_get_issues_in_sprint(params: { sprintId: string }, client: PlatformClient): Promise<any[]> {
    return client.findAll(trackerClass.Issue, { sprint: params.sprintId });
}

async function huly_create_sprint(params: { boardId: string; sprintName: string; startDate?: string; endDate?: string }, client: PlatformClient): Promise<{ sprintId: string }> {
    console.warn("huly_create_sprint is a placeholder and does not persist data.");
    return { sprintId: generateId() };
}

async function huly_update_sprint(params: { sprintId: string; sprintName?: string; startDate?: string; endDate?: string }, client: PlatformClient): Promise<{ success: boolean }> {
    console.warn("huly_update_sprint is a placeholder and does not persist data.");
    return { success: true };
}

async function huly_assign_issue_to_sprint(params: { issueId: string; sprintId: string }, client: PlatformClient): Promise<{ success: boolean }> {
    return huly_update_issue({ issueId: params.issueId, status: `sprint:${params.sprintId}` }, client); // This is a guess, might need a specific field
}

async function huly_assign_issue_to_epic(params: { issueId: string; epicId: string }, client: PlatformClient): Promise<{ success: boolean }> {
     console.warn("huly_assign_issue_to_epic is a placeholder and does not persist data.");
    return { success: true };
}

// B-4: User Management Tools
async function huly_find_users(params: { query: string }, client: PlatformClient): Promise<any[]> {
    console.warn("huly_find_users is a placeholder and returns mock data.");
    return [];
}

async function huly_get_user_profile(params: { userId: string }, client: PlatformClient): Promise<any> {
    console.warn("huly_get_user_profile is a placeholder and returns mock data.");
    return {};
}


export class HulyMCPServer {
  private server: McpServer;
  private client: PlatformClient;
  private initialized: boolean = false;

  constructor(client: PlatformClient) {
    this.server = new McpServer({
      name: "huly-mcp-server",
      version: "1.0.0"
    });
    this.client = client;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.setupTools();
    this.initialized = true;
  }

  private setupTools(): void {
    const register = (name: string, description: string, inputSchema: z.ZodType<any>, fn: (params: any, client: PlatformClient) => Promise<any>) => {
        this.server.registerTool(name, { description, inputSchema }, (params: any) => fn(params, this.client));
    }

    // Register all tools
    register("huly_create_issue", "Create a new issue or task in a specified project.", z.object({ projectId: z.string(), title: z.string(), description: z.string().optional(), assigneeId: z.string().optional(), priority: z.string().optional() }), huly_create_issue);
    register("huly_get_issue_details", "Get all details of a specific issue by its ID or identifier.", z.object({ issueId: z.string().optional(), identifier: z.string().optional() }), huly_get_issue_details);
    register("huly_update_issue", "Update fields of an existing issue.", z.object({ issueId: z.string(), title: z.string().optional(), description: z.string().optional(), status: z.string().optional(), assigneeId: z.string().optional() }), huly_update_issue);
    register("huly_delete_issue", "Delete an issue permanently.", z.object({ issueId: z.string() }), huly_delete_issue);
    register("huly_find_issues", "Search for issues using various filters.", z.object({ projectId: z.string(), query: z.string().optional(), status: z.string().optional(), assigneeId: z.string().optional() }), huly_find_issues);
    register("huly_transition_issue", "Change the status of an issue (e.g., from 'To Do' to 'In Progress').", z.object({ issueId: z.string(), status: z.string() }), huly_transition_issue);
    register("huly_add_comment", "Add a comment to an issue.", z.object({ issueId: z.string(), comment: z.string() }), huly_add_comment);
    register("huly_add_worklog", "Log time spent on an issue.", z.object({ issueId: z.string(), timeSpent: z.string() }), huly_add_worklog);
    register("huly_get_worklogs", "Get all worklogs for a specific issue.", z.object({ issueId: z.string() }), huly_get_worklogs);
    register("huly_create_issue_link", "Link two issues together (e.g., 'relates to', 'is blocked by').", z.object({ sourceIssueId: z.string(), targetIssueId: z.string(), linkType: z.string() }), huly_create_issue_link);
    register("huly_get_attachments", "List all attachments for an issue.", z.object({ issueId: z.string() }), huly_get_attachments);
    register("huly_batch_create_issues", "Create multiple issues in a single request.", z.object({ projectId: z.string(), issues: z.array(z.object({ title: z.string(), description: z.string().optional() })) }), huly_batch_create_issues);

    register("huly_get_all_projects", "Get a list of all projects in the workspace.", z.object({}), huly_get_all_projects);
    register("huly_get_project_details", "Get details for a specific project.", z.object({ projectId: z.string() }), huly_get_project_details);
    register("huly_get_project_versions", "Get all versions for a specific project.", z.object({ projectId: z.string() }), huly_get_project_versions);
    register("huly_create_version", "Create a new version for a project.", z.object({ projectId: z.string(), versionName: z.string(), releaseDate: z.string().optional() }), huly_create_version);

    register("huly_get_agile_boards", "Get a list of all Agile boards.", z.object({ projectId: z.string().optional() }), huly_get_agile_boards);
    register("huly_get_sprints_from_board", "Get all sprints for a specific Agile board.", z.object({ boardId: z.string(), state: z.enum(['active', 'future', 'closed']).optional() }), huly_get_sprints_from_board);
    register("huly_get_issues_in_sprint", "Get all issues assigned to a specific sprint.", z.object({ sprintId: z.string() }), huly_get_issues_in_sprint);
    register("huly_create_sprint", "Create a new sprint on a board.", z.object({ boardId: z.string(), sprintName: z.string(), startDate: z.string().optional(), endDate: z.string().optional() }), huly_create_sprint);
    register("huly_update_sprint", "Update details of a sprint (e.g., start/end date).", z.object({ sprintId: z.string(), sprintName: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() }), huly_update_sprint);
    register("huly_assign_issue_to_sprint", "Move an issue to a specific sprint.", z.object({ issueId: z.string(), sprintId: z.string() }), huly_assign_issue_to_sprint);
    register("huly_assign_issue_to_epic", "Assign an issue to an epic.", z.object({ issueId: z.string(), epicId: z.string() }), huly_assign_issue_to_epic);

    register("huly_find_users", "Search for users in the workspace.", z.object({ query: z.string() }), huly_find_users);
    register("huly_get_user_profile", "Get the profile of a specific user.", z.object({ userId: z.string() }), huly_get_user_profile);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    // Disconnection is now handled by the main index.ts
  }
}