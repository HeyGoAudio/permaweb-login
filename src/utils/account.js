import Arweave from 'arweave';
import { CryptoService } from './crypto';
import { ARWEAVE_CONFIG } from './config';

const GRAPHQL_ENDPOINT = 'https://arweave.net/graphql';

/**
 * Searches Arweave GraphQL (strictly arweave.net) for candidate transactions matching an Account-ID tag.
 * Returns up to 10 matching candidate transaction IDs to mitigate squatting / DoS attacks.
 * @param {string} accountId - Deterministic hash/tag of the account
 * @returns {Promise<string[]>} - Array of matching transaction IDs
 */
export async function findAccountTransactions(accountId) {
  const query = `
    query FindAccount($tags: [TagFilter!]) {
      transactions(tags: $tags, first: 10, sort: HEIGHT_DESC) {
        edges {
          node {
            id
            tags {
              name
              value
            }
          }
        }
      }
    }
  `;

  // 1. Primary search: App-Name + Account-ID
  const primaryTags = [
    { name: 'App-Name', values: ['Arweave-Login', 'My-App'] },
    { name: 'Account-ID', values: [accountId] }
  ];

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { tags: primaryTags }
      })
    });

    if (response.ok) {
      const json = await response.json();
      const edges = json?.data?.transactions?.edges || [];
      if (edges.length > 0) {
        const ids = edges.map((e) => e.node.id);
        console.log(`✅ Found ${ids.length} candidate account tx(s) on ${GRAPHQL_ENDPOINT}:`, ids);
        return ids;
      }
    }
  } catch (err) {
    console.warn(`GraphQL primary query failed on ${GRAPHQL_ENDPOINT}:`, err);
  }

  // 2. Fallback search: Exclusively by Account-ID in case App-Name was omitted
  const fallbackTags = [
    { name: 'Account-ID', values: [accountId] }
  ];

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { tags: fallbackTags }
      })
    });

    if (response.ok) {
      const json = await response.json();
      const edges = json?.data?.transactions?.edges || [];
      if (edges.length > 0) {
        const ids = edges.map((e) => e.node.id);
        console.log(`✅ Found ${ids.length} candidate account tx(s) with fallback query:`, ids);
        return ids;
      }
    }
  } catch (err) {
    console.warn(`GraphQL fallback query failed on ${GRAPHQL_ENDPOINT}:`, err);
  }

  return [];
}

/**
 * Legacy single-transaction lookup helper.
 * @param {string} accountId
 * @returns {Promise<string|null>}
 */
export async function findAccountTransaction(accountId) {
  const ids = await findAccountTransactions(accountId);
  return ids.length > 0 ? ids[0] : null;
}

/**
 * Fetches the encrypted wallet JSON payload from Arweave gateways for a given transaction ID.
 * @param {string} txId - Arweave Transaction ID
 * @returns {Promise<object>} - The encrypted wallet envelope ({ salt, iv, ciphertext, kdf? })
 */
export async function fetchEncryptedWallet(txId) {
  const gateways = [
    `https://arweave.net/${txId}`,
    `https://up.arweave.net/${txId}`
  ];

  for (const url of gateways) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data.salt && data.iv && data.ciphertext) {
          return data;
        }
      }
    } catch (err) {
      console.warn(`Gateway fetch failed for ${url}:`, err);
    }
  }

  throw new Error(`Transaction found (${txId}), but could not retrieve valid data envelope from gateways.`);
}

/**
 * Authenticated Account Unlock & Anti-Squatting Verifier.
 *
 * Derives the Account-ID from credentials, fetches candidate transactions from Arweave GraphQL,
 * and iterates through them attempting AES-GCM decryption.
 *
 * If a malicious actor attempted to squat or shadow the account with dummy data,
 * the GCM authentication check fails immediately, and this loop smoothly proceeds to the authentic transaction.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ walletKey: object, address: string, txId: string, encryptedWallet: object }>}
 */
export async function findAndUnlockAccount(email, password) {
  console.log('--- STARTING ACCOUNT SEARCH & AUTHENTICATION ---');

  // 1. Derive deterministic Account-ID using memory-hard Argon2id
  const accountId = await CryptoService.deriveAccountId(email, password);
  console.log(`Derived Account-ID: ${accountId}`);

  let candidateTxIds = await findAccountTransactions(accountId);

  // Fallback: If not found, check legacy email hash in case of older v0.1 account
  if (candidateTxIds.length === 0) {
    console.log('No v0.2 Argon2id account found. Checking legacy v0.1 Account-ID...');
    const legacyAccountId = await CryptoService.hashEmail(email);
    candidateTxIds = await findAccountTransactions(legacyAccountId);
  }

  if (candidateTxIds.length === 0) {
    throw new Error('No account found for this email address. Please verify your credentials or create a new account.');
  }

  console.log(`Testing ${candidateTxIds.length} candidate transaction(s) against authenticated decryption...`);

  // 2. Iterate through candidates to authenticate and decrypt (defeats squatting attacks)
  for (const txId of candidateTxIds) {
    try {
      console.log(`Fetching payload for candidate tx: ${txId}...`);
      const encryptedWallet = await fetchEncryptedWallet(txId);

      console.log(`Attempting AES-GCM authenticated decryption on tx ${txId}...`);
      const walletKey = await CryptoService.decrypt(encryptedWallet, password);

      const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);
      const address = await arweave.wallets.jwkToAddress(walletKey);

      console.log(`✅ Authentication SUCCESSFUL on tx ${txId}! Wallet Address: ${address}`);
      return { walletKey, address, txId, encryptedWallet };
    } catch (err) {
      console.warn(`Candidate tx ${txId} failed decryption/authentication (possible squatted or corrupted tx):`, err.message);
    }
  }

  throw new Error('Incorrect password or unable to authenticate any matching transaction.');
}

/**
 * Decrypts wallet with password and derives public address.
 * Kept for direct use where encrypted payload is already loaded.
 * @param {object} encryptedWallet - { salt, iv, ciphertext }
 * @param {string} password - User's password
 * @returns {Promise<{ walletKey: object, address: string }>}
 */
export async function decryptAndUnlockWallet(encryptedWallet, password) {
  const walletKey = await CryptoService.decrypt(encryptedWallet, password);
  const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);
  const address = await arweave.wallets.jwkToAddress(walletKey);
  return { walletKey, address };
}

/**
 * @deprecated Legacy lookup function. Use findAndUnlockAccount(email, password) instead.
 */
export async function findAccountByEmail(email) {
  const accountId = await CryptoService.hashEmail(email);
  const txId = await findAccountTransaction(accountId);
  if (!txId) return null;
  const encryptedWallet = await fetchEncryptedWallet(txId);
  return { txId, encryptedWallet, accountId };
}

/**
 * Fetches the current AR balance for an Arweave address.
 * @param {string} address - Arweave wallet address
 * @returns {Promise<{ ar: string, winston: string, formatted: string }>}
 */
export async function getWalletBalance(address) {
  if (!address) return { ar: '0', winston: '0', formatted: '0.0000' };
  try {
    const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);
    const winston = await arweave.wallets.getBalance(address);
    const ar = arweave.ar.winstonToAr(winston);
    const num = parseFloat(ar);
    let formatted = '0.0000';
    if (!isNaN(num)) {
      if (num === 0) {
        formatted = '0.0000';
      } else if (num < 0.0001) {
        formatted = '<0.0001';
      } else {
        formatted = num.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
      }
    }
    return { ar, winston, formatted };
  } catch (err) {
    console.warn(`Failed to retrieve balance for address ${address}:`, err);
    return { ar: '0', winston: '0', formatted: '0.0000' };
  }
}

/**
 * Prompts the browser to download the unencrypted Arweave JWK keyfile as JSON.
 * @param {object} walletKey - The unencrypted Arweave JWK object
 * @param {string} [address] - Optional wallet address for file naming
 */
export function downloadKeyfile(walletKey, address) {
  if (!walletKey) {
    throw new Error('No keyfile data available to download.');
  }
  const prefix = address ? address.slice(0, 8) : 'wallet';
  const fileName = `arweave-keyfile-${prefix}.json`;
  const blob = new Blob([JSON.stringify(walletKey, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Validates an Arweave JWK object and derives its public wallet address.
 * @param {object} jwk - Arweave RSA JWK keyfile
 * @returns {Promise<string>} - Public 43-character Arweave address
 */
export async function getAddressFromJwk(jwk) {
  if (!jwk || typeof jwk !== 'object' || !jwk.n || !jwk.d) {
    throw new Error('Invalid key file format. File must be an Arweave RSA private keyfile (JWK).');
  }
  const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);
  return await arweave.wallets.jwkToAddress(jwk);
}



