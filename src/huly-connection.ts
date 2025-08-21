import { connect, Client as HulyClient, ConnectOptions } from '@hcengineering/api-client';
import { HulyConfig, defaultConfig } from './config.js';

export class HulyConnection {
  private client: HulyClient | null = null;
  private config: HulyConfig;

  constructor(config: HulyConfig) {
    this.config = { ...defaultConfig, ...config };
  }

  async connect(): Promise<HulyClient> {
    if (this.client) {
      return this.client;
    }

    const options: ConnectOptions = {
      workspace: this.config.workspace,
    };

    // Add authentication options
    if (this.config.token) {
      options.token = this.config.token;
    } else if (this.config.email && this.config.password) {
      options.email = this.config.email;
      options.password = this.config.password;
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

  getClient(): HulyClient {
    if (!this.client) {
      throw new Error('Not connected to Huly. Call connect() first.');
    }
    return this.client;
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}