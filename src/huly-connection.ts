import apiClientPkg from '@hcengineering/api-client';
import type { PlatformClient, ConnectOptions } from '@hcengineering/api-client';
import { HulyConfig, defaultConfig } from './config.js';

// Extract connect function from CommonJS module
const connect = (apiClientPkg as any).connect;

export class HulyConnection {
  private client: PlatformClient | null = null;
  private config: HulyConfig;

  constructor(config: HulyConfig) {
    this.config = { ...defaultConfig, ...config };
  }

  async connect(): Promise<PlatformClient> {
    if (this.client) {
      return this.client;
    }

    // Create options based on authentication method
    let options: ConnectOptions;
    
    if (this.config.token) {
      options = {
        workspace: this.config.workspace,
        token: this.config.token
      } as ConnectOptions;
    } else if (this.config.email && this.config.password) {
      options = {
        workspace: this.config.workspace,
        email: this.config.email,
        password: this.config.password
      } as ConnectOptions;
    } else {
      throw new Error('Either token or email/password must be provided for Huly authentication');
    }

    try {
      this.client = await connect(this.config.url, options);
      console.info('[HulyConnection] Connected to', this.config.url, 'workspace=', this.config.workspace);
      return this.client;
    } catch (error) {
      throw new Error(`Failed to connect to Huly: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
  await this.client.close();
  this.client = null;
  console.info('[HulyConnection] Disconnected');
    }
  }

  getClient(): PlatformClient {
    if (!this.client) {
      throw new Error('Not connected to Huly. Call connect() first.');
    }
    return this.client;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  /**
   * Ping the server with a lightweight operation to verify the connection.
   * Returns true when the client is connected and responds, false otherwise.
   */
  async ping(timeoutMs = 5000): Promise<boolean> {
    if (!this.client) return false;
    try {
      // Use a lightweight call getModel() to verify connection
      const p = Promise.resolve().then(() => { this.client!.getModel(); return true; });
      const race = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
      const res = await Promise.race([p.catch(() => false), race]);
      return Boolean(res);
    } catch (_e) {
      return false;
    }
  }
}