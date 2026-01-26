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
  fetchPageToken,
  fetchPermissions,
  fetchInstagramAssets,
  fetchPageIgDebug,
} from './meta/client';
import { buildReport, buildReportForPage } from './reports';
import { recomputeConversationStats } from './db/recompute';
import {
  getSyncStatus,
  startMessengerSync,
  startInstagramSync,
} from './meta/sync';

export function createApp() {
  const config = loadConfig();
  const { db } = initDatabase(config.databasePath);

  const app = express();
  app.use(express.json());
  // Log every HTTP request
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.info(
        `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
      );
    });
    next();
  });

  // Global error handler for uncaught exceptions
  app.use(
    (
      err: unknown,
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      console.error(err);
      next(err);
    },
  );

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

  app.post('/api/sync/pages/:pageId/instagram/:igId', (req, res) => {
    const { pageId, igId } = req.params;
    const pageRow = db
      .select()
      .from(metaPages)
      .where(eq(metaPages.id, pageId))
      .get();
    if (!pageRow) {
      res.status(400).json({ error: 'Page not enabled' });
      return;
    }
    const igAsset = db
      .select()
      .from(igAssets)
      .where(eq(igAssets.id, igId))
      .get();
    if (!igAsset) {
      res.status(400).json({ error: 'Instagram asset not enabled' });
      return;
    }
    const runId = startInstagramSync({ db, config, pageId, igId });
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
      console.error(error);
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
      console.error(error);
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
      console.error(error);
      res.status(502).json({
        error:
          error instanceof Error ? error.message : 'Meta pages fetch failed',
      });
    }
  });

  app.get('/api/meta/pages/:pageId/ig-assets', async (req, res) => {
    const { pageId } = req.params;
    const pageRow = db
      .select()
      .from(metaPages)
      .where(eq(metaPages.id, pageId))
      .get();
    if (!pageRow) {
      res.status(404).json({ error: 'Page not enabled' });
      return;
    }

    const inputToken = decryptString(
      {
        ciphertext: pageRow.encryptedAccessToken,
        iv: pageRow.iv,
        tag: pageRow.tag,
      },
      config.appEncryptionKey,
    );

    try {
      let assets: Awaited<ReturnType<typeof fetchInstagramAssets>> = [];
      try {
        assets = await fetchInstagramAssets({
          pageId,
          accessToken: inputToken,
          version: config.metaApiVersion,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('Page Access Token')) {
          const userTokenRow = db
            .select()
            .from(metaTokens)
            .orderBy(desc(metaTokens.createdAt))
            .get();
          if (!userTokenRow) {
            res.status(401).json({ error: 'No Meta token' });
            return;
          }
          const userToken = decryptString(
            {
              ciphertext: userTokenRow.encryptedValue,
              iv: userTokenRow.iv,
              tag: userTokenRow.tag,
            },
            config.appEncryptionKey,
          );
          const page = await fetchPageToken({
            pageId,
            accessToken: userToken,
            version: config.metaApiVersion,
          });
          const encrypted = encryptString(
            page.accessToken,
            config.appEncryptionKey,
          );
          db.insert(metaPages)
            .values({
              id: pageId,
              name: page.name,
              encryptedAccessToken: encrypted.ciphertext,
              iv: encrypted.iv,
              tag: encrypted.tag,
              updatedAt: new Date().toISOString(),
            })
            .onConflictDoUpdate({
              target: metaPages.id,
              set: {
                encryptedAccessToken: encrypted.ciphertext,
                iv: encrypted.iv,
                tag: encrypted.tag,
                updatedAt: new Date().toISOString(),
              },
            })
            .run();
          assets = await fetchInstagramAssets({
            pageId,
            accessToken: page.accessToken,
            version: config.metaApiVersion,
          });
        } else {
          throw error;
        }
      }
      if (!assets.length) {
        const userTokenRow = db
          .select()
          .from(metaTokens)
          .orderBy(desc(metaTokens.createdAt))
          .get();
        if (userTokenRow) {
          const userToken = decryptString(
            {
              ciphertext: userTokenRow.encryptedValue,
              iv: userTokenRow.iv,
              tag: userTokenRow.tag,
            },
            config.appEncryptionKey,
          );
          try {
            assets = await fetchInstagramAssets({
              pageId,
              accessToken: userToken,
              version: config.metaApiVersion,
            });
          } catch (fallbackError) {
            console.warn('IG assets user-token fallback failed');
            console.warn(fallbackError);
          }
        }
      }
      assets.forEach((asset) => {
        db.insert(igAssets)
          .values({
            id: asset.id,
            name: asset.name ?? asset.id,
            pageId,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: igAssets.id,
            set: {
              name: asset.name ?? asset.id,
              pageId,
              updatedAt: new Date().toISOString(),
            },
          })
          .run();
      });
      const stored = db
        .select({
          id: igAssets.id,
          name: igAssets.name,
          pageId: igAssets.pageId,
        })
        .from(igAssets)
        .where(eq(igAssets.pageId, pageId))
        .all();
      res.json({ igAssets: stored });
    } catch (error) {
      console.error(error);
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Meta IG assets failed',
      });
    }
  });

  app.get('/api/meta/pages/:pageId/ig-debug', async (req, res) => {
    const { pageId } = req.params;
    const pageRow = db
      .select()
      .from(metaPages)
      .where(eq(metaPages.id, pageId))
      .get();
    if (!pageRow) {
      res.status(404).json({ error: 'Page not enabled' });
      return;
    }

    const pageToken = decryptString(
      {
        ciphertext: pageRow.encryptedAccessToken,
        iv: pageRow.iv,
        tag: pageRow.tag,
      },
      config.appEncryptionKey,
    );

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

    try {
      const pageData = await fetchPageIgDebug({
        pageId,
        accessToken: pageToken,
        version: config.metaApiVersion,
      });

      let userData = null as null | typeof pageData;
      if (userToken) {
        userData = await fetchPageIgDebug({
          pageId,
          accessToken: userToken,
          version: config.metaApiVersion,
        });
      }

      res.json({
        pageId,
        pageToken: {
          instagram_business_account: pageData?.instagram_business_account,
          connected_instagram_account: pageData?.connected_instagram_account,
        },
        userToken: userData
          ? {
              instagram_business_account:
                userData?.instagram_business_account,
              connected_instagram_account:
                userData?.connected_instagram_account,
            }
          : null,
      });
    } catch (error) {
      console.error(error);
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Meta IG debug failed',
      });
    }
  });

  app.post('/api/meta/pages/:pageId/ig-assets', (req, res) => {
    const { pageId } = req.params;
    const id = typeof req.body?.id === 'string' ? req.body.id : null;
    const name = typeof req.body?.name === 'string' ? req.body.name : null;
    if (!id) {
      res.status(400).json({ error: 'Missing ig asset id' });
      return;
    }
    db.insert(igAssets)
      .values({
        id,
        name: name ?? id,
        pageId,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: igAssets.id,
        set: {
          name: name ?? id,
          pageId,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();
    res.json({ id, name: name ?? id, pageId });
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
      const trimmedClient = pageNameFromClient?.trim() ?? '';
      const normalizedClient = trimmedClient.toLowerCase();
      const resolvedName =
        !trimmedClient || normalizedClient === 'page'
          ? page.name
          : trimmedClient;
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
      console.error(error);
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

    res.json({ pageId, name: name.trim(), skipped: true });
  });

  app.get('/api/assets', async (_req, res) => {
    const pages = db
      .select({
        id: metaPages.id,
        name: metaPages.name,
      })
      .from(metaPages)
      .all();
    const enrichedPages = pages.map((page) => {
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
        name: page.name,
        lastSyncedAt: lastSync?.lastSyncedAt ?? null,
        conversationCount,
        messageCount,
      };
    });
    const ig = db
      .select({ id: igAssets.id, name: igAssets.name, pageId: igAssets.pageId })
      .from(igAssets)
      .all();
    res.json({
      pages: enrichedPages,
      igAssets: ig,
      igEnabled: config.igEnabled,
    });
  });

  app.delete('/api/pages/:pageId', (req, res) => {
    const { pageId } = req.params;
    db.delete(messages).where(eq(messages.pageId, pageId)).run();
    db.delete(conversations).where(eq(conversations.pageId, pageId)).run();
    db.delete(syncStates).where(eq(syncStates.pageId, pageId)).run();
    db.delete(igAssets).where(eq(igAssets.pageId, pageId)).run();
    db.delete(metaPages).where(eq(metaPages.id, pageId)).run();
    res.json({ deleted: true, pageId });
  });

  return { app, config, db };
}
