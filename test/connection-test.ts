#!/usr/bin/env tsx

import { HulyConnection } from '../src/huly-connection.js';
import { HulyConfig } from '../src/config.js';

async function testConnection() {
  const config: HulyConfig = {
    url: 'https://huly.app',
    workspace: 'test-workspace',
    email: 'test@example.com',
    password: 'test-password'
  };

  const connection = new HulyConnection(config);

  console.log('Initial connection state:', connection.isConnected());

  try {
    console.log('Attempting to connect...');
    await connection.connect();
    console.log('Connection state after connect:', connection.isConnected());
    
    console.log('Testing ping...');
    const pingResult = await connection.ping(3000);
    console.log('Ping result:', pingResult);
    
  } catch (error) {
    console.log('Connection failed (expected with invalid credentials):', error.message);
    console.log('Connection state after failed connect:', connection.isConnected());
  }

  console.log('Testing ping without connection...');
  const pingWithoutConnection = await connection.ping(1000);
  console.log('Ping without connection:', pingWithoutConnection);

  await connection.disconnect();
  console.log('Connection state after disconnect:', connection.isConnected());
}

testConnection().catch(console.error);
