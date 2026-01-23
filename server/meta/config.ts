export const metaConfig = {
  version: 'v19.0',
  baseUrl: 'https://graph.facebook.com',
  endpoints: {
    oauthAccessToken: '/oauth/access_token',
    debugToken: '/debug_token',
    meAccounts: '/me/accounts',
    conversations: (pageId: string) => `/${pageId}/conversations`,
    messages: (conversationId: string) => `/${conversationId}/messages`,
    igAccounts: (pageId: string) => `/${pageId}/instagram_accounts`,
  },
  fields: {
    pages: ['id', 'name', 'access_token'],
    conversations: ['id', 'updated_time'],
    messages: ['id', 'from', 'created_time', 'message'],
    igAccounts: ['id', 'name'],
  },
};
