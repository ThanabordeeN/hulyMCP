#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { HulyMCPServer } from './huly-mcp-server.js';
import { HulyConfig } from './config.js';
import { fileURLToPath } from 'url';
import path from 'path';

function loadConfig(): HulyConfig {
  const config: HulyConfig = {
    url: process.env.HULY_URL || 'http://localhost:8087',
    workspace: process.env.HULY_WORKSPACE || 'ws1',
    connectionTimeout: process.env.HULY_CONNECTION_TIMEOUT ? 
      parseInt(process.env.HULY_CONNECTION_TIMEOUT, 10) : 30000,
  };

  // Authentication: prefer token, fallback to email/password
  if (process.env.HULY_TOKEN) {
    config.token = process.env.HULY_TOKEN;
  } else if (process.env.HULY_EMAIL && process.env.HULY_PASSWORD) {
    config.email = process.env.HULY_EMAIL;
    config.password = process.env.HULY_PASSWORD;
  } else {
    // Default values for development
    config.email = 'user1';
    config.password = '1234';
  }

  return config;
}

async function main() {
  try {
    const config = loadConfig();
    const server = new HulyMCPServer(config);
    
    console.error('Starting Huly MCP Server...');
    console.error(`Connecting to: ${config.url}`);
    console.error(`Workspace: ${config.workspace}`);
    console.error(`Authentication: ${config.token ? 'Token' : 'Email/Password'}`);
    
    await server.start();
    console.error('Huly MCP Server started successfully');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.error('Shutting down Huly MCP Server...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('Shutting down Huly MCP Server...');
      await server.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start Huly MCP Server:', error);
    process.exit(1);
  }
}

// Use a normalized, platform-safe comparison to determine whether this file
// was invoked directly. Make the check permissive so npm shims and Windows
// path formats are handled (compare absolute paths, basenames, and suffixes).
const entryScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisFile = path.resolve(fileURLToPath(import.meta.url));
const entryBasename = entryScript ? path.basename(entryScript) : '';
const thisBasename = path.basename(thisFile);
const invokedDirectly = Boolean(
  entryScript && (
    entryScript === thisFile ||
    entryBasename === thisBasename ||
    thisFile.endsWith(path.sep + entryBasename) ||
    entryScript.endsWith(thisBasename)
  )
);

if (invokedDirectly) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { HulyMCPServer } from './huly-mcp-server.js';
export { HulyConfig } from './config.js';