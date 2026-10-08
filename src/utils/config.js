export const ARWEAVE_CONFIG = {
  // Arweave Gateway configuration (used for querying, network state, etc.)
  gateway: {
    host: 'arweave.net',
    port: 443,
    protocol: 'https',
  },
  // ANS-104 Bundler endpoint (used for free, fast data transaction dispatch)
  bundler: {
    url: 'https://up.arweave.net',
    txEndpoint: 'https://up.arweave.net/tx',
  },
  // Application default metadata tags
  app: {
    name: 'Arweave-Login',
    version: '0.1'
  },
};
