// Mock implementation for @hcengineering/rank

export function makeRank(prev?: string, next?: string): string {
  return `mock_rank_${Date.now()}`;
}

export default { makeRank };