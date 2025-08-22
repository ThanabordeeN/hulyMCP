#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { HulyConfig } from './config.js';
import { HulyClientFactory } from './huly-connection.js';
import { HulyMCPServer } from './huly-mcp-server.js';
import { PlatformClient } from '@hcengineering/api-client';

// Load environment variables from .env file
dotenv.config();

function loadConfig(): HulyConfig {
  const config: HulyConfig = {
    url: process.env.HULY_URL || 'http://localhost:8087',
    workspace: process.env.HULY_WORKSPACE || 'ws1',
    connectionTimeout: process.env.HULY_CONNECTION_TIMEOUT
      ? parseInt(process.env.HULY_CONNECTION_TIMEOUT, 10)
      : 30000,
  };

  // Authentication: prefer token, fallback to email/password
  if (process.env.HULY_TOKEN) {
    config.token = process.env.HULY_TOKEN;
  } else if (process.env.HULY_EMAIL && process.env.HULY_PASSWORD) {
    config.email = process.env.HULY_EMAIL;
    config.password = process.env.HULY_PASSWORD;
  } else {
    console.warn('Warning: No HULY_TOKEN or HULY_EMAIL/HULY_PASSWORD found. Using default development credentials.');
    // Default values for development
    config.email = 'user1';
    config.password = '1234';
  }

  return config;
}

async function main() {
  let hulyClient: PlatformClient | null = null;

  try {
    const config = loadConfig();
    
    console.error('Attempting to connect to Huly...');
    console.error(`URL: ${config.url}`);
    console.error(`Workspace: ${config.workspace}`);
    console.error(`Authentication Method: ${config.token ? 'Token' : 'Email/Password'}`);

    const clientFactory = new HulyClientFactory(config);
    hulyClient = await clientFactory.createConnectedClient();

    console.error('Huly connection successful. Starting MCP Server...');
    
    const server = new HulyMCPServer(hulyClient);
    await server.initialize();
    await server.start();

    console.error('Huly MCP Server started successfully.');

  } catch (error) {
    console.error('Failed to start Huly MCP Server:', error);
    if (hulyClient) {
      await hulyClient.close();
    }
    process.exit(1);
  }

  async function gracefulShutdown() {
    console.error('Shutting down Huly MCP Server...');
    if (hulyClient) {
      await hulyClient.close();
      console.error('Huly client disconnected.');
    }
    process.exit(0);
  }

  // Handle graceful shutdown
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

// Use a normalized, platform-safe comparison to determine whether this file
// was invoked directly.
const entryScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisFile = path.resolve(fileURLToPath(import.meta.url));
const invokedDirectly = entryScript === thisFile;

if (invokedDirectly) {
  main().catch((error) => {
    console.error('Unhandled error during execution:', error);
    process.exit(1);
  });
}

export { HulyMCPServer } from './huly-mcp-server.js';
export { HulyConfig } from './config.js';