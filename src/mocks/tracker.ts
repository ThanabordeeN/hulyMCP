// Mock implementation for @hcengineering/tracker

import { IssuePriority } from '../types.js';

export { IssuePriority };

export const tracker = {
  class: {
    Project: 'tracker.class.Project',
    Issue: 'tracker.class.Issue',
    IssueStatus: 'tracker.class.IssueStatus',
    IssueComment: 'tracker.class.IssueComment',
    Component: 'tracker.class.Component',
    Sprint: 'tracker.class.Sprint'
  },
  space: {
    Project: 'tracker.space.Project'
  }
};

export default tracker;