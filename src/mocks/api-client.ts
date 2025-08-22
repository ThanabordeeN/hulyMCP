// Mock implementation for @hcengineering/api-client

import type { PlatformClient, ConnectOptions } from '../types.js';

export class MockPlatformClient implements PlatformClient {
  async findOne(className: any, query: any, options?: any): Promise<any> {
    return null;
  }

  async findAll(className: any, query: any, options?: any): Promise<any[]> {
    return [];
  }

  async createDoc(className: any, space: any, doc: any, id?: any): Promise<any> {
    return { _id: id || 'mock-id' };
  }

  async updateDoc(className: any, space: any, id: any, operations: any, retrieve?: boolean): Promise<any> {
    return { _id: id };
  }

  async removeDoc(className: any, space: any, id: any): Promise<void> {
    // Mock implementation
  }

  async addCollection(className: any, space: any, id: any, parentClass: any, field: string, doc: any, docId?: any): Promise<any> {
    return { _id: docId || 'mock-collection-id' };
  }

  async close(): Promise<void> {
    // Mock implementation
  }

  async createMarkup(_class: any, objectId: any, field: string, content: string): Promise<any> {
    return {
      _id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content: content,
      field: field
    };
  }

  async uploadMarkup(content: string): Promise<any> {
    return {
      _id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content: content
    };
  }

  async fetchMarkup(_class: any, objectId: any, field: string, content: any, format?: string): Promise<string> {
    return content || '';
  }

  getModel(): any {
    return {};
  }

  async updateCollection(className: any, space: any, id: any, parentClass: any, field: string, doc: any, docId?: any): Promise<any> {
    return { _id: docId || 'mock-collection-id' };
  }

  async removeCollection(className: any, space: any, id: any, parentClass: any, field: string, docId: any): Promise<void> {
    // Mock implementation
  }

  async createMixin(objectId: any, _class: any, space: any, mixin: any, doc?: any): Promise<any> {
    return { _id: 'mock-mixin-id' };
  }

  async updateMixin(objectId: any, _class: any, space: any, mixin: any, operations?: any): Promise<any> {
    return { _id: 'mock-mixin-id' };
  }
}

export async function connect(url: string, options: ConnectOptions): Promise<PlatformClient> {
  return new MockPlatformClient();
}

export type { PlatformClient, ConnectOptions };

// Default export for CommonJS compatibility
export default { connect };