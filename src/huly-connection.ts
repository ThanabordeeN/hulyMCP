import { connect, type PlatformClient, type ConnectOptions } from '@hcengineering/api-client';
import { HulyConfig, defaultConfig } from './config.js';

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
      return this.client;
    } catch (error) {
      throw new Error(`Failed to connect to Huly: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
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
}