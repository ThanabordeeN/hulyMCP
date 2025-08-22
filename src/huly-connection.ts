import { HulyConfig } from './config.js';
import { connect, PlatformClient, ConnectOptions } from '@hcengineering/api-client';

/**
 * A factory for creating and connecting a Huly PlatformClient.
 */
export class HulyClientFactory {
  private config: HulyConfig;

  constructor(config: HulyConfig) {
    this.config = config;
  }

  /**
   * Creates and connects a new Huly PlatformClient instance.
   * @returns A connected PlatformClient instance.
   */
  async createConnectedClient(): Promise<PlatformClient> {
    let options: ConnectOptions;

    if (this.config.token) {
      options = {
        workspace: this.config.workspace,
        token: this.config.token,
      };
    } else if (this.config.email && this.config.password) {
      options = {
        workspace: this.config.workspace,
        email: this.config.email,
        password: this.config.password,
      };
    } else {
      throw new Error('Either token or email/password must be provided for Huly authentication');
    }

    try {
      const client = await connect(this.config.url, options);
      console.info('[HulyClientFactory] Successfully connected to', this.config.url, 'for workspace', this.config.workspace);
      return client;
    } catch (error) {
      console.error('[HulyClientFactory] Failed to connect to Huly:', error);
      throw new Error(`Failed to connect to Huly: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}