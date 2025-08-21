import {
  HulyClient,
  ConnectOptions,
  FindOptions,
  Ref,
} from './huly-types.js';

// Mock client kept for API compatibility but does not contain sample/mock data.
// All query methods return empty results or no-op so the codebase doesn't rely on
// embedded demo data. For real Huly integration, replace this module with the
// official Huly client as described in REAL_HULY_INTEGRATION.md.

export class MockHulyClient implements HulyClient {
  private connected = false;

  constructor(private config: ConnectOptions) {}

  async connect(): Promise<void> {
    // Minimal validation to keep behavior consistent with previous mock.
    if (!this.config.token && (!this.config.email || !this.config.password)) {
      throw new Error('Authentication required: provide either token or email/password');
    }
    this.connected = true;
  }

  async findOne<T>(_class: string, _query: Partial<T>, _options?: FindOptions): Promise<T | undefined> {
    if (!this.connected) throw new Error('Not connected');
    return undefined; // no mock data available
  }

  async findAll<T>(_class: string, _query: Partial<T>, _options?: FindOptions): Promise<T[]> {
    if (!this.connected) throw new Error('Not connected');
    return []; // no mock data available
  }

  async addCollection(
    _class: string,
    _space: Ref<any>,
    _parent: Ref<any>,
    _parentClass: string,
    _collection: string,
    _attributes: any,
    _id?: Ref<any>
  ): Promise<void> {
    if (!this.connected) throw new Error('Not connected');
    // no-op: mock client no longer stores demo data
  }

  async updateDoc(_class: string, _space: Ref<any>, _objectId: Ref<any>, _operations: any, _retrieve?: boolean): Promise<any> {
    if (!this.connected) throw new Error('Not connected');
    return undefined;
  }

  async uploadMarkup(_class: string, objectId: Ref<any>, _field: string, _value: string, _format: string): Promise<string> {
    if (!this.connected) throw new Error('Not connected');
    return `markup_${Date.now()}_${objectId}`;
  }

  async fetchMarkup(_class: string, _objectId: Ref<any>, _field: string, _value: string, _format: string): Promise<string> {
    if (!this.connected) throw new Error('Not connected');
    return ''; // no stored markup available
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}

export async function connect(_url: string, options: ConnectOptions): Promise<HulyClient> {
  const client = new MockHulyClient(options);
  await client.connect();
  return client;
}

export type { HulyClient };