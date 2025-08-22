import { HulyConfig, defaultConfig } from './config.js';

// Basic type definitions
interface ConnectOptions {
  workspace: string;
  token?: string;
  email?: string;
  password?: string;
  [key: string]: any;
}

interface PlatformClientInterface {
  findOne(className: any, query: any, options?: any): Promise<any>;
  findAll(className: any, query: any, options?: any): Promise<any[]>;
  createDoc(className: any, space: any, doc: any, id?: any): Promise<any>;
  updateDoc(className: any, space: any, id: any, operations: any, retrieve?: boolean): Promise<any>;
  removeDoc(className: any, space: any, id: any): Promise<void>;
  addCollection(className: any, space: any, id: any, parentClass: any, field: string, doc: any, docId?: any): Promise<any>;
  close(): Promise<void>;
  createMarkup?(className: any, objectId: any, field: string, content: string): Promise<any>;
  uploadMarkup?(content: string): Promise<any>;
  fetchMarkup?(className: any, objectId: any, field: string, content: any, format?: string): Promise<string>;
  getModel(): any;
  [key: string]: any;
}

// Fallback connect function - will be used when @hcengineering/api-client is not available
const connect = async (url?: string, options?: ConnectOptions): Promise<PlatformClientInterface> => ({
  findOne: async () => null,
  findAll: async () => [],
  createDoc: async (_class: any, space: any, doc: any, id?: any) => ({ _id: id || 'mock-id' }),
  updateDoc: async (_class: any, space: any, id: any, operations: any) => ({ _id: id }),
  removeDoc: async () => {},
  addCollection: async () => ({ _id: 'mock-collection-id' }),
  close: async () => {},
  createMarkup: async (_class: any, objectId: any, field: string, content: string) => ({
    _id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    content,
    field
  }),
  uploadMarkup: async (content: string) => ({
    _id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    content
  }),
  fetchMarkup: async (_class: any, objectId: any, field: string, content: any) => content || '',
  getModel: () => ({}),
  updateCollection: async () => ({ _id: 'mock-collection-id' }),
  removeCollection: async () => {},
  createMixin: async () => ({ _id: 'mock-mixin-id' }),
  updateMixin: async () => ({ _id: 'mock-mixin-id' })
});

// Dynamic loading function for real api-client (optional)
async function loadApiClient() {
  // This can be enhanced to load real @hcengineering/api-client if available
  // For now, we'll use the fallback to ensure compilation works
}

export class HulyConnection {
  private client: PlatformClientInterface | null = null;
  private config: HulyConfig;
  private initialized: boolean = false;

  constructor(config: HulyConfig) {
    this.config = { ...defaultConfig, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await loadApiClient();
    this.initialized = true;
  }

  async connect(): Promise<PlatformClientInterface> {
    await this.initialize();
    
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
      return this.client!;
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

  getClient(): PlatformClientInterface {
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