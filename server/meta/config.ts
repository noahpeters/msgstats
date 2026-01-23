export const metaConfig = {
  version: 'v19.0',
  baseUrl: 'https://graph.facebook.com',
  endpoints: {
    oauthAccessToken: '/oauth/access_token',
    debugToken: '/debug_token',
    meBusinesses: '/me/businesses',
    mePermissions: '/me/permissions',
    businessOwnedPages: (businessId: string) => `/${businessId}/owned_pages`,
    businessClientPages: (businessId: string) => `/${businessId}/client_pages`,
    pageDetails: (pageId: string) => `/${pageId}`,
    conversations: (pageId: string) => `/${pageId}/conversations`,
    conversationDetails: (conversationId: string) => `/${conversationId}`,
    conversationMessages: (conversationId: string) =>
      `/${conversationId}/messages`,
    igAccounts: (pageId: string) => `/${pageId}/instagram_accounts`,
  },
  fields: {
    businesses: ['id', 'name'],
    pages: ['id', 'name'],
    pageName: ['id', 'name'],
    pageWithToken: ['id', 'name', 'access_token'],
    permissions: ['permission', 'status'],
    conversations: ['id', 'updated_time'],
    messages: ['id', 'from', 'created_time'],
    igAccounts: ['id', 'name'],
  },
};
