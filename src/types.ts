// Type definitions and mock interfaces for Huly MCP Server

// Mock PlatformClient interface
export interface PlatformClient {
  findOne(className: any, query: any, options?: any): Promise<any>;
  findAll(className: any, query: any, options?: any): Promise<any[]>;
  createDoc(className: any, space: any, doc: any, id?: any): Promise<any>;
  updateDoc(className: any, space: any, id: any, operations: any, retrieve?: boolean): Promise<any>;
  removeDoc(className: any, space: any, id: any): Promise<void>;
  addCollection(className: any, space: any, id: any, parentClass: any, field: string, doc: any, docId?: any): Promise<any>;
  close(): Promise<void>;
  createMarkup?(
    _class: any,
    objectId: any,
    field: string,
    content: string
  ): Promise<any>;
  uploadMarkup?(content: string): Promise<any>;
  fetchMarkup?(
    _class: any,
    objectId: any,
    field: string,
    content: any,
    format?: string
  ): Promise<string>;
  getModel?(): any;
  updateCollection?(className: any, space: any, id: any, parentClass: any, field: string, doc: any, docId?: any): Promise<any>;
  removeCollection?(className: any, space: any, id: any, parentClass: any, field: string, docId: any): Promise<void>;
  createMixin?(objectId: any, _class: any, space: any, doc: any): Promise<any>;
  updateMixin?(objectId: any, _class: any, space: any, operations: any): Promise<any>;
}

// Mock ConnectOptions interface
export interface ConnectOptions {
  workspace: string;
  token?: string;
  email?: string;
  password?: string;
}

// Mock types from @hcengineering/core
export interface Ref<T> {
  __ref: T;
}

export interface WithLookup<T> {
  _id: Ref<T>;
  _class: Ref<any>;
  space: Ref<any>;
  modifiedOn: number;
  modifiedBy: Ref<any>;
  createdOn?: number;
  createdBy?: Ref<any>;
  $lookup?: any;
  $associations?: any;
  $source?: any;
  // Add common properties that are accessed
  identifier?: string;
  name?: string;
  description?: string;
  private?: boolean;
  archived?: boolean;
  members?: Ref<any>[];
  defaultIssueStatus?: Ref<any>;
  sequence?: number;
  startDate?: number;
  targetDate?: number;
  capacity?: number;
  title?: string;
  assignee?: Ref<any>;
  status?: Ref<any>;
  priority?: any;
  number?: number;
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

export interface Doc<T> {
  _id: Ref<T>;
  _class: Ref<any>;
  space: Ref<any>;
  modifiedOn: number;
  modifiedBy: Ref<any>;
  createdOn?: number;
  createdBy?: Ref<any>;
}

// Mock types from @hcengineering/tracker
export interface Issue extends Doc<Issue> {
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

export interface Project extends Doc<Project> {
  name: string;
  identifier: string;
  description?: string;
  private: boolean;
  archived: boolean;
  members: Ref<any>[];
  defaultIssueStatus?: Ref<any>;
  sequence?: number;
}

export interface Space extends Doc<Space> {
  name: string;
  description: string;
  private: boolean;
  archived: boolean;
  members: Ref<any>[];
  startDate?: number;
  targetDate?: number;
  capacity?: number;
}

// Extended document update types to include sprint property
export interface ExtendedDocumentUpdate {
  sprint?: any;
  parents?: any[];
  status?: any;
  space?: any;
  startDate?: number;
  targetDate?: number;
  capacity?: number;
}

// Extended space type to include sprint properties
export interface ExtendedSpace {
  _id: any;
  name?: string;
  startDate?: number;
  targetDate?: number;
  capacity?: number;
}

// Issue parent info interface
export interface IssueParentInfo {
  parentId: any;
  identifier: string;
  parentTitle: string;
  space: any;
}

// Helper type for Ref casting
export type RefType<T> = T & { __ref: any };

// Status reference type
export interface StatusRef {
  __ref: any;
}

// Sorting order enum
export enum SortingOrder {
  Ascending = 1,
  Descending = -1
}

// Issue priority enum
export enum IssuePriority {
  Urgent = 0,
  High = 1,
  Medium = 2,
  Low = 3
}