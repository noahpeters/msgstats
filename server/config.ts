export type AppConfig = {
  metaAppId: string;
  metaAppSecret: string;
  metaRedirectUri: string;
  appEncryptionKey: string;
  databasePath: string;
  metaApiVersion: string;
  igEnabled: boolean;
  metaScopes: string[];
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
  const scopes = (
    process.env.META_SCOPES ??
    'pages_show_list,pages_manage_metadata,business_management,pages_messaging'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    metaAppId: requireEnv('META_APP_ID'),
    metaAppSecret: requireEnv('META_APP_SECRET'),
    metaRedirectUri: requireEnv('META_REDIRECT_URI'),
    appEncryptionKey: requireEnv('APP_ENCRYPTION_KEY'),
    databasePath: process.env.DATABASE_PATH ?? './data/msgstats.sqlite',
    metaApiVersion: process.env.META_API_VERSION ?? metaConfig.version,
    igEnabled: process.env.IG_ENABLED === 'true',
    metaScopes: scopes,
  };
}
