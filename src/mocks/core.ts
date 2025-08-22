// Mock implementation for @hcengineering/core

import { SortingOrder } from '../types.js';

export function generateId(): string {
  return `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export { SortingOrder };

export const core = {
  space: {
    Space: 'core.space.Space'
  }
};

export default core;