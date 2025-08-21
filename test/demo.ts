#!/usr/bin/env node

/**
 * Simple demonstration script showing the MCP server capabilities
 * This script shows the available tools and sample data
 */

import { HulyMCPServer } from '../src/huly-mcp-server.js';
import { HulyConfig } from '../src/config.js';

async function demonstrate() {
  console.log('🚀 Huly MCP Server Demonstration\n');

  const config: HulyConfig = {
    url: 'http://localhost:8087',
    workspace: 'ws1',
    email: 'user1',
    password: '1234'
  };

  console.log('Configuration:');
  console.log(`- URL: ${config.url}`);
  console.log(`- Workspace: ${config.workspace}`);
  console.log(`- Authentication: Email/Password\n`);

  console.log('🔧 Available MCP Tools:');
  console.log('1. list-issues - List issues in a project');
  console.log('2. create-issue - Create new issues');
  console.log('3. get-issue - Get detailed issue information');
  console.log('4. list-projects - List all projects\n');

  console.log('📁 Available MCP Resources:');
  console.log('1. huly://project/{identifier} - Project information');
  console.log('2. huly://issue/{identifier} - Issue details\n');

  console.log('📝 Available MCP Prompts:');
  console.log('1. create-issue-template - Issue creation templates');
  console.log('2. project-review-template - Project review templates\n');

  console.log('📊 Sample Mock Data Available:');
  console.log('Projects:');
  console.log('- HULY: Huly Platform (main development project)');
  console.log('- DOCS: Documentation project\n');

  console.log('Issues:');
  console.log('- HULY-101: Implement user authentication (High priority, in-progress)');
  console.log('- HULY-102: Fix navigation bug in mobile view (Urgent, todo)');
  console.log('- HULY-103: Add dark mode support (Normal, backlog)');
  console.log('- DOCS-15: Update API documentation (Normal, review)\n');

  console.log('💡 To use this MCP server:');
  console.log('1. Build: npm run build');
  console.log('2. Start: npm start (or node dist/index.js)');
  console.log('3. Connect with MCP client (see examples.md for configuration)');
  console.log('4. For real Huly integration, see REAL_HULY_INTEGRATION.md\n');

  console.log('🎯 This implementation demonstrates a fully functional MCP server');
  console.log('   that can be easily adapted to work with real Huly instances.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrate().catch(console.error);
}