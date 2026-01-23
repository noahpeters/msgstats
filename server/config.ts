export type AppConfig = {
  metaAppId: string;
  metaAppSecret: string;
  metaRedirectUri: string;
  appEncryptionKey: string;
  databasePath: string;
  metaApiVersion: string;
  igEnabled: boolean;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

import { metaConfig } from './meta/config';

export function loadConfig(): AppConfig {
  return {
    metaAppId: requireEnv('META_APP_ID'),
    metaAppSecret: requireEnv('META_APP_SECRET'),
    metaRedirectUri: requireEnv('META_REDIRECT_URI'),
    appEncryptionKey: requireEnv('APP_ENCRYPTION_KEY'),
    databasePath: process.env.DATABASE_PATH ?? './data/msgstats.sqlite',
    metaApiVersion: process.env.META_API_VERSION ?? metaConfig.version,
    igEnabled: process.env.IG_ENABLED === 'true',
  };
}
