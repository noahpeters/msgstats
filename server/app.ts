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
import { decryptString, encryptString } from './security/encryption';
import { debugToken, exchangeCodeForToken, fetchPages } from './meta/client';
import { startMetaSync } from './meta/sync';
import { buildReport } from './reports';
import { recomputeConversationStats } from './db/recompute';

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
      scope: config.metaScopes.join(','),
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

  app.get('/api/reports/weekly', (req, res) => {
    const bucketBy = req.query.bucketBy === 'updated' ? 'updated' : 'start';
    res.json(buildReport(db, 'weekly', bucketBy));
  });

  app.get('/api/reports/monthly', (req, res) => {
    const bucketBy = req.query.bucketBy === 'updated' ? 'updated' : 'start';
    res.json(buildReport(db, 'monthly', bucketBy));
  });

  app.post('/api/recompute', async (_req, res) => {
    const result = await recomputeConversationStats(db);
    res.json(result);
  });

  app.get('/api/meta/debug', async (_req, res) => {
    const tokenRow = db
      .select()
      .from(metaTokens)
      .orderBy(desc(metaTokens.createdAt))
      .get();

    if (!tokenRow) {
      res.json({ hasToken: false });
      return;
    }

    let inputToken: string;
    try {
      inputToken = decryptString(
        {
          ciphertext: tokenRow.encryptedValue,
          iv: tokenRow.iv,
          tag: tokenRow.tag,
        },
        config.appEncryptionKey,
      );
    } catch (error) {
      res.status(500).json({
        hasToken: true,
        error: 'Failed to decode token',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    try {
      const debug = await debugToken({
        inputToken,
        appId: config.metaAppId,
        appSecret: config.metaAppSecret,
        version: config.metaApiVersion,
      });
      res.json({ hasToken: true, debug });
    } catch (error) {
      res.status(500).json({
        hasToken: true,
        error: 'Meta debug failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/meta/pages', async (_req, res) => {
    const tokenRow = db
      .select()
      .from(metaTokens)
      .orderBy(desc(metaTokens.createdAt))
      .get();

    if (!tokenRow) {
      res.json({ hasToken: false, pages: [] });
      return;
    }

    try {
      const inputToken = decryptString(
        {
          ciphertext: tokenRow.encryptedValue,
          iv: tokenRow.iv,
          tag: tokenRow.tag,
        },
        config.appEncryptionKey,
      );
      const pages = await fetchPages({
        accessToken: inputToken,
        version: config.metaApiVersion,
        fields: ['id', 'name', 'access_token'],
      });
      const basic = await fetchPages({
        accessToken: inputToken,
        version: config.metaApiVersion,
        fields: ['id', 'name'],
      });
      res.json({ hasToken: true, pages, basic });
    } catch (error) {
      res.status(500).json({
        hasToken: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
