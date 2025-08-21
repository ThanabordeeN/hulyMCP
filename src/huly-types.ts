// Type definitions based on Huly Platform API
export type Ref<T> = string & { readonly __ref: T };

export enum SortingOrder {
  Ascending = 'asc',
  Descending = 'desc'
}

export enum IssuePriority {
  Urgent = 'Urgent',
  High = 'High', 
  Normal = 'Normal',
  Low = 'Low'
}

export interface Issue {
  _id: Ref<Issue>;
  _class: string;
  identifier: string;
  title: string;
  description?: string;
  priority: IssuePriority;
  status: string;
  assignee?: string;
  estimation: number;
  remainingTime: number;
  reportedTime: number;
  number: number;
  createdOn: number;
  modifiedOn: number;
  dueDate?: number;
  subIssues: number;
  reports: number;
  space: Ref<Project>;
  rank?: string;
}

export interface Project {
  _id: Ref<Project>;
  _class: string;
  identifier: string;
  name: string;
  description?: string;
  type?: string;
  private: boolean;
  archived: boolean;
  defaultIssueStatus: string;
  sequence: number;
  createdOn: number;
  modifiedOn: number;
  $lookup?: {
    type?: ProjectType;
  };
}

export interface ProjectType {
  _id: Ref<ProjectType>;
  name: string;
  statuses: string[];
}

export interface ConnectOptions {
  email?: string;
  password?: string;
  token?: string;
  workspace: string;
  socketFactory?: any;
  connectionTimeout?: number;
}

export interface FindOptions {
  limit?: number;
  sort?: Record<string, SortingOrder>;
  lookup?: Record<string, any>;
}

export interface HulyClient {
  findOne<T>(
    _class: string,
    query: Partial<T>,
    options?: FindOptions
  ): Promise<T | undefined>;

  findAll<T>(
    _class: string,
    query: Partial<T>,
    options?: FindOptions
  ): Promise<T[]>;

  addCollection(
    _class: string,
    space: Ref<any>,
    parent: Ref<any>,
    parentClass: string,
    collection: string,
    attributes: any,
    id?: Ref<any>
  ): Promise<void>;

  updateDoc(
    _class: string,
    space: Ref<any>,
    objectId: Ref<any>,
    operations: any,
    retrieve?: boolean
  ): Promise<any>;

  uploadMarkup(
    _class: string,
    objectId: Ref<any>,
    field: string,
    value: string,
    format: string
  ): Promise<string>;

  fetchMarkup(
    _class: string,
    objectId: Ref<any>,
    field: string,
    value: string,
    format: string
  ): Promise<string>;

  close(): Promise<void>;
}

// Mock classes for demonstration
export const tracker = {
  class: {
    Issue: 'tracker:class:Issue',
    Project: 'tracker:class:Project'
  },
  taskTypes: {
    Issue: 'task:Issue'
  }
};

export const task = {
  class: {
    ProjectType: 'task:class:ProjectType'
  }
};

export const core = {
  space: {
    Space: 'core:space:Space'
  }
};

export function generateId<T>(): Ref<T> {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` as Ref<T>;
}

export function makeRank(prevRank?: string, nextRank?: string): string {
  // Simple rank generation for demonstration
  if (!prevRank) return 'a0';
  const base = prevRank.charCodeAt(0);
  return String.fromCharCode(base + 1) + '0';
}