export interface HulyConfig {
  url: string;
  email?: string;
  password?: string;
  token?: string;
  workspace: string;
  connectionTimeout?: number;
}

export const defaultConfig: Partial<HulyConfig> = {
  url: 'http://localhost:8087',
  connectionTimeout: 30000,
};