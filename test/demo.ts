#!/usr/bin/env node

/**
 * Simple demonstration script showing the MCP server capabilities
 * This script shows the available tools for connecting to real Huly instances
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

  // No embedded mock data. Uses real Huly API client integration.
  // For setup instructions, see REAL_HULY_INTEGRATION.md

  console.log('💡 To use this MCP server:');
  console.log('1. Build: npm run build');
  console.log('2. Start: npm start (or node dist/index.js)');
  console.log('3. Connect with MCP client (see examples.md for configuration)');
  console.log('4. Configuration instructions: see REAL_HULY_INTEGRATION.md\n');

  console.log('🎯 This implementation uses real Huly API integration');
  console.log('   and connects directly to live Huly instances.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrate().catch(console.error);
}