// Utility functions for Huly MCP Server

// Polyfill for createMarkup method when it doesn't exist
export async function createMarkupPolyfill(
  client: any,
  _class: any,
  objectId: any,
  field: string,
  content: string
): Promise<any> {
  // If createMarkup exists, use it
  if (typeof client.createMarkup === 'function') {
    return await client.createMarkup(_class, objectId, field, content);
  }
  
  // Otherwise, return a simple reference or handle as plain text
  // This is a fallback for when the method doesn't exist
  return {
    _id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    content: content,
    field: field
  };
}

// Helper to safely access sprint properties
export function getSprintProperty(sprint: any, property: string, defaultValue: any = null): any {
  if (!sprint || typeof sprint !== 'object') {
    return defaultValue;
  }
  return sprint[property] !== undefined ? sprint[property] : defaultValue;
}

// Helper to create proper Ref types
export function asRef<T>(value: any): T {
  return value as T;
}

// Helper to create issue parent info
export function createIssueParentInfo(parentId: any, identifier: string, parentTitle: string, space: any) {
  return {
    parentId,
    identifier, 
    parentTitle,
    space
  };
}