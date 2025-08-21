import { 
  HulyClient, 
  ConnectOptions, 
  FindOptions, 
  Issue, 
  Project, 
  ProjectType, 
  IssuePriority, 
  SortingOrder, 
  Ref,
  generateId,
  tracker,
  task,
  core
} from './huly-types.js';

// Mock data for demonstration
const mockProjects: Project[] = [
  {
    _id: 'project_huly' as Ref<Project>,
    _class: tracker.class.Project,
    identifier: 'HULY',
    name: 'Huly Platform',
    description: 'Main Huly platform development project',
    private: false,
    archived: false,
    defaultIssueStatus: 'backlog',
    sequence: 105,
    createdOn: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
    modifiedOn: Date.now() - 1000,
    $lookup: {
      type: {
        _id: 'type_software' as Ref<ProjectType>,
        name: 'Software Development',
        statuses: ['backlog', 'todo', 'in-progress', 'review', 'done']
      }
    }
  },
  {
    _id: 'project_docs' as Ref<Project>,
    _class: tracker.class.Project,
    identifier: 'DOCS',
    name: 'Documentation',
    description: 'Documentation and user guides',
    private: false,
    archived: false,
    defaultIssueStatus: 'backlog',
    sequence: 23,
    createdOn: Date.now() - 20 * 24 * 60 * 60 * 1000, // 20 days ago
    modifiedOn: Date.now() - 5000,
    $lookup: {
      type: {
        _id: 'type_docs' as Ref<ProjectType>,
        name: 'Documentation',
        statuses: ['draft', 'review', 'published']
      }
    }
  }
];

const mockIssues: Issue[] = [
  {
    _id: 'issue_1' as Ref<Issue>,
    _class: tracker.class.Issue,
    identifier: 'HULY-101',
    title: 'Implement user authentication',
    description: 'Add OAuth2 authentication system with support for multiple providers',
    priority: IssuePriority.High,
    status: 'in-progress',
    assignee: 'alice@example.com',
    estimation: 8,
    remainingTime: 3,
    reportedTime: 5,
    number: 101,
    createdOn: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
    modifiedOn: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
    subIssues: 2,
    reports: 0,
    space: 'project_huly' as Ref<Project>,
    rank: 'a1'
  },
  {
    _id: 'issue_2' as Ref<Issue>,
    _class: tracker.class.Issue,
    identifier: 'HULY-102',
    title: 'Fix navigation bug in mobile view',
    description: 'Navigation menu is not accessible on mobile devices when screen width < 768px',
    priority: IssuePriority.Urgent,
    status: 'todo',
    assignee: 'bob@example.com',
    estimation: 4,
    remainingTime: 4,
    reportedTime: 0,
    number: 102,
    createdOn: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
    modifiedOn: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
    subIssues: 0,
    reports: 1,
    space: 'project_huly' as Ref<Project>,
    rank: 'a2'
  },
  {
    _id: 'issue_3' as Ref<Issue>,
    _class: tracker.class.Issue,
    identifier: 'HULY-103',
    title: 'Add dark mode support',
    description: 'Implement dark theme for better user experience during night time',
    priority: IssuePriority.Normal,
    status: 'backlog',
    estimation: 6,
    remainingTime: 6,
    reportedTime: 0,
    number: 103,
    createdOn: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
    modifiedOn: Date.now() - 30 * 60 * 1000, // 30 minutes ago
    subIssues: 0,
    reports: 0,
    space: 'project_huly' as Ref<Project>,
    rank: 'a3'
  },
  {
    _id: 'issue_4' as Ref<Issue>,
    _class: tracker.class.Issue,
    identifier: 'DOCS-15',
    title: 'Update API documentation',
    description: 'Update the REST API documentation with new endpoints and examples',
    priority: IssuePriority.Normal,
    status: 'review',
    assignee: 'charlie@example.com',
    estimation: 3,
    remainingTime: 1,
    reportedTime: 2,
    number: 15,
    createdOn: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
    modifiedOn: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    subIssues: 0,
    reports: 0,
    space: 'project_docs' as Ref<Project>,
    rank: 'b1'
  }
];

export class MockHulyClient implements HulyClient {
  private connected = false;

  constructor(private config: ConnectOptions) {}

  async connect(): Promise<void> {
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Validate credentials
    if (!this.config.token && (!this.config.email || !this.config.password)) {
      throw new Error('Authentication required: provide either token or email/password');
    }
    
    this.connected = true;
  }

  async findOne<T>(
    _class: string,
    query: Partial<T>,
    options?: FindOptions
  ): Promise<T | undefined> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    if (_class === tracker.class.Project) {
      const project = mockProjects.find(p => 
        Object.entries(query).every(([key, value]) => 
          (p as any)[key] === value
        )
      );
      return project as T | undefined;
    }

    if (_class === tracker.class.Issue) {
      const issue = mockIssues.find(i => 
        Object.entries(query).every(([key, value]) => 
          (i as any)[key] === value
        )
      );
      return issue as T | undefined;
    }

    return undefined;
  }

  async findAll<T>(
    _class: string,
    query: Partial<T>,
    options?: FindOptions
  ): Promise<T[]> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    let results: any[] = [];

    if (_class === tracker.class.Project) {
      results = mockProjects.filter(p => 
        Object.entries(query).every(([key, value]) => 
          (p as any)[key] === value
        )
      );
    } else if (_class === tracker.class.Issue) {
      results = mockIssues.filter(i => 
        Object.entries(query).every(([key, value]) => 
          (i as any)[key] === value
        )
      );
    }

    // Apply sorting
    if (options?.sort) {
      const sortEntries = Object.entries(options.sort);
      if (sortEntries.length > 0) {
        const sortEntry = sortEntries[0];
        if (sortEntry) {
          const [sortField, sortOrder] = sortEntry;
          results.sort((a, b) => {
            const aVal = (a as any)[sortField];
            const bVal = (b as any)[sortField];
            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return sortOrder === SortingOrder.Ascending ? comparison : -comparison;
          });
        }
      }
    }

    // Apply limit
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results as T[];
  }

  async addCollection(
    _class: string,
    space: Ref<any>,
    parent: Ref<any>,
    parentClass: string,
    collection: string,
    attributes: any,
    id?: Ref<any>
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    if (_class === tracker.class.Issue) {
      const issueId = id || generateId<Issue>();
      const newIssue: Issue = {
        _id: issueId,
        _class,
        space,
        createdOn: Date.now(),
        modifiedOn: Date.now(),
        subIssues: 0,
        reports: 0,
        remainingTime: attributes.estimation || 0,
        reportedTime: 0,
        ...attributes
      };
      mockIssues.push(newIssue);
    }
  }

  async updateDoc(
    _class: string,
    space: Ref<any>,
    objectId: Ref<any>,
    operations: any,
    retrieve?: boolean
  ): Promise<any> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    if (_class === tracker.class.Project) {
      const project = mockProjects.find(p => p._id === objectId);
      if (project && operations.$inc?.sequence) {
        project.sequence += operations.$inc.sequence;
        project.modifiedOn = Date.now();
        return retrieve ? { object: project } : undefined;
      }
    }

    return undefined;
  }

  async uploadMarkup(
    _class: string,
    objectId: Ref<any>,
    field: string,
    value: string,
    format: string
  ): Promise<string> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    // Return a mock reference ID for the uploaded markup
    return `markup_${Date.now()}_${objectId}`;
  }

  async fetchMarkup(
    _class: string,
    objectId: Ref<any>,
    field: string,
    value: string,
    format: string
  ): Promise<string> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    // Return the stored markup value or a default for mock data
    const issue = mockIssues.find(i => i._id === objectId);
    if (issue && field === 'description') {
      return issue.description || 'No description available';
    }

    return 'Mock markup content';
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}

// Factory function to create client (matches Huly API pattern)
export async function connect(url: string, options: ConnectOptions): Promise<HulyClient> {
  const client = new MockHulyClient(options);
  await client.connect();
  return client;
}

// Export HulyClient for use in other modules
export type { HulyClient };