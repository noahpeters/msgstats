import express from 'express';
import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { loadConfig } from './config';
import { initDatabase } from './db';
import {
  metaOauthStates,
  metaTokens,
  metaPages,
  syncRuns,
  igAssets,
} from './db/schema';
import { encryptString } from './security/encryption';
import { exchangeCodeForToken } from './meta/client';
import { startMetaSync } from './meta/sync';
import { buildReport } from './reports';

export function createApp() {
  const config = loadConfig();
  const { db } = initDatabase(config.databasePath);

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/auth/meta/start', (_req, res) => {
    const state = crypto.randomUUID();
    db.insert(metaOauthStates)
      .values({
        state,
        createdAt: new Date().toISOString(),
      })
      .run();

    const params = new URLSearchParams({
      client_id: config.metaAppId,
      redirect_uri: config.metaRedirectUri,
      state,
      response_type: 'code',
      scope:
        'pages_messaging,pages_read_engagement,pages_show_list,instagram_basic,instagram_manage_messages',
    });

    const authUrl = `https://www.facebook.com/${config.metaApiVersion}/dialog/oauth?${params.toString()}`;
    res.redirect(authUrl);
  });

  app.get('/auth/meta/callback', async (req, res) => {
    const { code, state } = req.query;

    if (
      !code ||
      typeof code !== 'string' ||
      !state ||
      typeof state !== 'string'
    ) {
      res.status(400).send('Invalid OAuth response');
      return;
    }

    const storedState = db
      .select()
      .from(metaOauthStates)
      .where(eq(metaOauthStates.state, state))
      .get();

    if (!storedState) {
      res.status(400).send('Invalid OAuth state');
      return;
    }

    db.delete(metaOauthStates).where(eq(metaOauthStates.state, state)).run();

    try {
      const token = await exchangeCodeForToken({
        appId: config.metaAppId,
        appSecret: config.metaAppSecret,
        redirectUri: config.metaRedirectUri,
        code,
        version: config.metaApiVersion,
      });

      const encrypted = encryptString(
        token.accessToken,
        config.appEncryptionKey,
      );
      db.insert(metaTokens)
        .values({
          encryptedValue: encrypted.ciphertext,
          iv: encrypted.iv,
          tag: encrypted.tag,
          tokenType: token.tokenType,
          expiresAt: token.expiresIn
            ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
            : null,
          createdAt: new Date().toISOString(),
        })
        .run();

      res.redirect('/');
    } catch {
      res.status(500).send('OAuth token exchange failed');
    }
  });

  app.post('/api/sync', async (_req, res) => {
    const runId = await startMetaSync({ db, config });
    res.json({ runId });
  });

  app.get('/api/sync/status', (_req, res) => {
    const run = db
      .select()
      .from(syncRuns)
      .orderBy(desc(syncRuns.startedAt))
      .get();

    if (!run) {
      res.json({ status: 'idle' });
      return;
    }

    res.json({
      status: run.status,
      lastRunId: run.id,
      progress: {
        pages: run.pages,
        conversations: run.conversations,
        messages: run.messages,
      },
      lastError: run.lastError,
    });
  });

  app.get('/api/reports/weekly', (_req, res) => {
    res.json(buildReport(db, 'weekly'));
  });

  app.get('/api/reports/monthly', (_req, res) => {
    res.json(buildReport(db, 'monthly'));
  });

  app.get('/api/assets', (_req, res) => {
    const pages = db
      .select({ id: metaPages.id, name: metaPages.name })
      .from(metaPages)
      .all();
    const ig = db
      .select({ id: igAssets.id, name: igAssets.name, pageId: igAssets.pageId })
      .from(igAssets)
      .all();
    res.json({
      pages,
      igAssets: ig,
      igEnabled: config.igEnabled,
    });
  });

  return { app, config, db };
}
