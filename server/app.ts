import express from 'express';
import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { loadConfig } from './config';
import { initDatabase } from './db';
import {
  metaOauthStates,
  metaTokens,
  metaPages,
  igAssets,
  conversations,
  messages,
  syncStates,
} from './db/schema';
import { decryptString, encryptString } from './security/encryption';
import {
  exchangeCodeForToken,
  fetchBusinessPages,
  fetchBusinesses,
  fetchPageName,
  fetchPageToken,
  fetchPermissions,
} from './meta/client';
import { buildReport, buildReportForPage } from './reports';
import { recomputeConversationStats } from './db/recompute';
import { getSyncStatus, startMessengerSync } from './meta/sync';

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
      auth_type: 'rerequest',
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

  app.post('/api/sync/pages/:pageId/messenger', (req, res) => {
    const { pageId } = req.params;
    const runId = startMessengerSync({ db, config, pageId });
    res.json({ runId });
  });

  app.get('/api/sync/status', (_req, res) => {
    res.json(getSyncStatus());
  });

  app.get('/api/reports/weekly', (req, res) => {
    const pageId =
      typeof req.query.pageId === 'string' ? req.query.pageId : undefined;
    const bucketBy = req.query.bucketBy === 'updated' ? 'updated' : 'start';
    const rows = pageId
      ? buildReportForPage(db, pageId, 'weekly', bucketBy)
      : buildReport(db, 'weekly', bucketBy);
    res.json(rows);
  });

  app.get('/api/reports/monthly', (req, res) => {
    const pageId =
      typeof req.query.pageId === 'string' ? req.query.pageId : undefined;
    const bucketBy = req.query.bucketBy === 'updated' ? 'updated' : 'start';
    const rows = pageId
      ? buildReportForPage(db, pageId, 'monthly', bucketBy)
      : buildReport(db, 'monthly', bucketBy);
    res.json(rows);
  });

  app.post('/api/recompute', async (_req, res) => {
    const result = await recomputeConversationStats(db);
    res.json(result);
  });

  app.get('/api/meta/permissions', async (_req, res) => {
    const tokenRow = db
      .select()
      .from(metaTokens)
      .orderBy(desc(metaTokens.createdAt))
      .get();

    if (!tokenRow) {
      res.json({ hasToken: false, permissions: [], missing: [] });
      return;
    }

    const inputToken = decryptString(
      {
        ciphertext: tokenRow.encryptedValue,
        iv: tokenRow.iv,
        tag: tokenRow.tag,
      },
      config.appEncryptionKey,
    );

    try {
      const permissions = await fetchPermissions({
        accessToken: inputToken,
        version: config.metaApiVersion,
      });
      const granted = permissions
        .filter((perm) => perm.status === 'granted')
        .map((perm) => perm.permission);
      const missing = config.metaScopes.filter(
        (scope) => !granted.includes(scope),
      );
      res.json({ hasToken: true, permissions, missing });
    } catch (error) {
      res.status(502).json({
        hasToken: true,
        permissions: [],
        missing: config.metaScopes,
        error:
          error instanceof Error ? error.message : 'Meta permissions failed',
      });
    }
  });

  app.get('/api/meta/businesses', async (_req, res) => {
    const tokenRow = db
      .select()
      .from(metaTokens)
      .orderBy(desc(metaTokens.createdAt))
      .get();
    if (!tokenRow) {
      res.status(401).json({ error: 'No Meta token' });
      return;
    }

    const inputToken = decryptString(
      {
        ciphertext: tokenRow.encryptedValue,
        iv: tokenRow.iv,
        tag: tokenRow.tag,
      },
      config.appEncryptionKey,
    );

    try {
      const businesses = await fetchBusinesses({
        accessToken: inputToken,
        version: config.metaApiVersion,
      });
      res.json(businesses);
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error ? error.message : 'Meta business fetch failed',
      });
    }
  });

  app.get('/api/meta/businesses/:businessId/pages', async (req, res) => {
    const { businessId } = req.params;
    const tokenRow = db
      .select()
      .from(metaTokens)
      .orderBy(desc(metaTokens.createdAt))
      .get();
    if (!tokenRow) {
      res.status(401).json({ error: 'No Meta token' });
      return;
    }

    const inputToken = decryptString(
      {
        ciphertext: tokenRow.encryptedValue,
        iv: tokenRow.iv,
        tag: tokenRow.tag,
      },
      config.appEncryptionKey,
    );

    try {
      const result = await fetchBusinessPages({
        businessId,
        accessToken: inputToken,
        version: config.metaApiVersion,
      });
      res.json(
        result.pages.map((page) => ({
          id: page.id,
          name: page.name,
          source: result.source,
        })),
      );
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error ? error.message : 'Meta pages fetch failed',
      });
    }
  });

  app.post('/api/meta/pages/:pageId/token', async (req, res) => {
    const { pageId } = req.params;
    const pageNameFromClient =
      typeof req.body?.name === 'string'
        ? req.body.name
        : typeof req.query?.name === 'string'
          ? req.query.name
          : null;
    const tokenRow = db
      .select()
      .from(metaTokens)
      .orderBy(desc(metaTokens.createdAt))
      .get();
    if (!tokenRow) {
      res.status(401).json({ error: 'No Meta token' });
      return;
    }

    const inputToken = decryptString(
      {
        ciphertext: tokenRow.encryptedValue,
        iv: tokenRow.iv,
        tag: tokenRow.tag,
      },
      config.appEncryptionKey,
    );

    try {
      const page = await fetchPageToken({
        pageId,
        accessToken: inputToken,
        version: config.metaApiVersion,
      });
      const resolvedName = pageNameFromClient?.trim() || page.name;
      const encrypted = encryptString(
        page.accessToken,
        config.appEncryptionKey,
      );
      db.insert(metaPages)
        .values({
          id: page.id,
          name: resolvedName,
          encryptedAccessToken: encrypted.ciphertext,
          iv: encrypted.iv,
          tag: encrypted.tag,
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: metaPages.id,
          set: {
            name: resolvedName,
            encryptedAccessToken: encrypted.ciphertext,
            iv: encrypted.iv,
            tag: encrypted.tag,
            updatedAt: new Date().toISOString(),
          },
        })
        .run();

      res.json({ pageId: page.id, name: resolvedName });
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error ? error.message : 'Meta page token failed',
      });
    }
  });

  app.post('/api/meta/pages/:pageId/name', (req, res) => {
    const { pageId } = req.params;
    const name =
      typeof req.body?.name === 'string'
        ? req.body.name
        : typeof req.query?.name === 'string'
          ? req.query.name
          : null;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Missing page name' });
      return;
    }

    const result = db
      .update(metaPages)
      .set({ name: name.trim(), updatedAt: new Date().toISOString() })
      .where(eq(metaPages.id, pageId))
      .run();
    if (result.changes === 0) {
      res.status(404).json({ error: 'Page not enabled yet' });
      return;
    }

    res.json({ pageId, name: name.trim() });
  });

  app.get('/api/assets', async (_req, res) => {
    const userTokenRow = db
      .select()
      .from(metaTokens)
      .orderBy(desc(metaTokens.createdAt))
      .get();
    const userToken = userTokenRow
      ? decryptString(
          {
            ciphertext: userTokenRow.encryptedValue,
            iv: userTokenRow.iv,
            tag: userTokenRow.tag,
          },
          config.appEncryptionKey,
        )
      : null;
    const pages = db
      .select({
        id: metaPages.id,
        name: metaPages.name,
        encryptedAccessToken: metaPages.encryptedAccessToken,
        iv: metaPages.iv,
        tag: metaPages.tag,
      })
      .from(metaPages)
      .all();
    const refreshedPages = await Promise.all(
      pages.map(async (page) => {
        let name = page.name;
        const normalizedName = name?.trim().toLowerCase();
        if (!name || !name.trim() || normalizedName === 'page') {
          try {
            const pageToken = decryptString(
              {
                ciphertext: page.encryptedAccessToken,
                iv: page.iv,
                tag: page.tag,
              },
              config.appEncryptionKey,
            );
            const fresh = await fetchPageName({
              pageId: page.id,
              accessToken: pageToken,
              version: config.metaApiVersion,
            });
            name = fresh.name;
            db.update(metaPages)
              .set({ name })
              .where(eq(metaPages.id, page.id))
              .run();
          } catch {
            // ignore refresh errors, keep existing name
          }
        }
        const normalizedAfterPageToken = name?.trim().toLowerCase();
        if (
          userToken &&
          (!name || !name.trim() || normalizedAfterPageToken === 'page')
        ) {
          try {
            const fresh = await fetchPageName({
              pageId: page.id,
              accessToken: userToken,
              version: config.metaApiVersion,
            });
            name = fresh.name;
            db.update(metaPages)
              .set({ name })
              .where(eq(metaPages.id, page.id))
              .run();
          } catch {
            // ignore refresh errors, keep existing name
          }
        }
        const conversationCount = db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.pageId, page.id))
          .all().length;
        const messageCount = db
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.pageId, page.id))
          .all().length;
        const lastSync = db
          .select({ lastSyncedAt: syncStates.lastSyncedAt })
          .from(syncStates)
          .where(eq(syncStates.pageId, page.id))
          .orderBy(desc(syncStates.updatedAt))
          .get();
        return {
          id: page.id,
          name,
          lastSyncedAt: lastSync?.lastSyncedAt ?? null,
          conversationCount,
          messageCount,
        };
      }),
    );
    const ig = db
      .select({ id: igAssets.id, name: igAssets.name, pageId: igAssets.pageId })
      .from(igAssets)
      .all();
    res.json({
      pages: refreshedPages,
      igAssets: ig,
      igEnabled: config.igEnabled,
    });
  });

  return { app, config, db };
}
