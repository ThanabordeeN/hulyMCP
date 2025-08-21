# Connection Status Guide

Your Huly MCP Server now includes connection monitoring and health check capabilities.

## New Features

### 1. Connection Logging
When you connect or disconnect from Huly, you'll see console messages:
```
[HulyConnection] Connected to https://huly.app workspace= your-workspace
[HulyConnection] Disconnected
```

### 2. Connection State Check
Check if the client is connected:
```typescript
const isConnected = hulyConnection.isConnected(); // returns boolean
```

### 3. Health Check / Ping
Test if the server is responding:
```typescript
const isHealthy = await hulyConnection.ping(); // returns Promise<boolean>
const isHealthyWithTimeout = await hulyConnection.ping(5000); // custom timeout in ms
```

## Usage Examples

### In Your MCP Server Code
```typescript
// Before making API calls, ensure connection is healthy
if (hulyConnection.isConnected()) {
  const pingOk = await hulyConnection.ping();
  if (pingOk) {
    // Safe to make API calls
    const client = hulyConnection.getClient();
    // ... use client
  } else {
    console.log('Connection not responding, may need to reconnect');
  }
} else {
  console.log('Not connected to Huly');
}
```

### Quick Connection Test
Run the test script to see the connection features in action:
```bash
npx tsx test/connection-test.ts
```

## Connection States

| State | `isConnected()` | `ping()` | Description |
|-------|----------------|----------|-------------|
| Not connected | `false` | `false` | No connection established |
| Connected & healthy | `true` | `true` | Ready for API calls |
| Connected but unhealthy | `true` | `false` | Connection exists but server not responding |

## Troubleshooting

1. **Server not responding**: If `ping()` returns `false` but `isConnected()` is `true`, the connection may have been dropped. Try reconnecting.

2. **Connection fails**: Check the console logs for detailed error messages about authentication or network issues.

3. **Timeout issues**: Adjust the ping timeout based on your network conditions. Default is 5 seconds.
