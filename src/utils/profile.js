import Account from 'arweave-account';
import Arweave from 'arweave';
import { ARWEAVE_CONFIG } from './config';
import { createData, ArweaveSigner } from 'arbundles';
import { Buffer } from 'buffer';
import { MAX_MEDIA_BYTES } from './imageCompression';

let accountInstance = null;

/**
 * Returns the singleton Arweave Account instance.
 */
export function getAccountInstance() {
  if (!accountInstance) {
    accountInstance = new Account({
      gateway: {
        host: ARWEAVE_CONFIG.gateway.host,
        port: ARWEAVE_CONFIG.gateway.port,
        protocol: ARWEAVE_CONFIG.gateway.protocol,
        timeout: 20000,
        logging: false,
      },
      cacheIsActivated: true,
      cacheSize: 50,
      cacheTime: 60000,
      defaultAvatarUri: 'ar://OrG-ZG2WN3wdcwvpjz1ihPe4MI24QBJUpsJGIdL85wA',
      defaultBannerUri: 'ar://a0ieiziq2JkYhWamlrUCHxrGYnHWUAMcONxRmfkWt-k',
    });
  }
  return accountInstance;
}

/**
 * Default empty profile conforming to arweave-account protocol.
 */
export const DEFAULT_AVATAR = 'ar://OrG-ZG2WN3wdcwvpjz1ihPe4MI24QBJUpsJGIdL85wA';
export const DEFAULT_BANNER = 'ar://a0ieiziq2JkYhWamlrUCHxrGYnHWUAMcONxRmfkWt-k';

export function resolveArweaveUri(uri) {
  if (!uri) return '';
  if (/^[a-zA-Z0-9\-_]{43}$/.test(uri)) {
    return `https://arweave.net/${uri}`;
  }
  if (uri.startsWith('ar://')) {
    const txId = uri.replace('ar://', '');
    return `https://arweave.net/${txId}`;
  }
  return uri;
}

/**
 * Fetches existing arweave-account profile for an address.
 * @param {string} address - 43-character Arweave wallet address
 * @returns {Promise<object>} - Decoded ArAccount object
 */
export async function fetchProfile(address) {
  if (!address) throw new Error('Address is required to fetch profile');
  const account = getAccountInstance();
  return await account.get(address);
}

/**
 * Publishes / updates an arweave-account profile to the permaweb.
 * Supports both JWK keyfile/credentials (via free ANS-104 bundler) and browser extension (via window.arweaveWallet.dispatch).
 *
 * @param {object} profile - Profile fields conforming to T_profile
 * @param {object|null} walletKey - User's JWK keyfile (null if using browser wallet)
 * @param {string} address - Public wallet address
 * @returns {Promise<{ id: string, account: object }>}
 */
export async function publishProfile(profile, walletKey, address, { onStatus = null } = {}) {
  if (!profile || !profile.handleName) {
    throw new Error('A handle name is required to publish an arweave-account profile.');
  }

  const account = getAccountInstance();

  // Connect identity
  if (walletKey) {
    onStatus?.('Preparing profile update...');
    await account.connect(walletKey);
  } else if (typeof window !== 'undefined' && window.arweaveWallet) {
    onStatus?.('Connecting to browser wallet...');
    await account.connect('use_wallet');
  } else {
    throw new Error('No active wallet or keyfile found to sign profile publication.');
  }

  // Ensure clean profile structure
  const formattedProfile = {
    handleName: profile.handleName.trim(),
    name: profile.name ? profile.name.trim() : '',
    bio: profile.bio ? profile.bio.trim() : '',
    avatar: profile.avatar || DEFAULT_AVATAR,
    avatarURL: resolveArweaveUri(profile.avatar || DEFAULT_AVATAR),
    banner: profile.banner || DEFAULT_BANNER,
    bannerURL: resolveArweaveUri(profile.banner || DEFAULT_BANNER),
    email: profile.email ? profile.email.trim() : '',
    links: {
      twitter: profile.links?.twitter ? profile.links.twitter.trim() : '',
      github: profile.links?.github ? profile.links.github.trim() : '',
      instagram: profile.links?.instagram ? profile.links.instagram.trim() : '',
      discord: profile.links?.discord ? profile.links.discord.trim() : '',
      linkedin: profile.links?.linkedin ? profile.links.linkedin.trim() : '',
      facebook: profile.links?.facebook ? profile.links.facebook.trim() : '',
      youtube: profile.links?.youtube ? profile.links.youtube.trim() : '',
      twitch: profile.links?.twitch ? profile.links.twitch.trim() : '',
    },
    wallets: {
      eth: profile.wallets?.eth ? profile.wallets.eth.trim() : '',
    },
  };

  console.log('Publishing profile payload to Arweave:', formattedProfile);

  if (!walletKey) {
    onStatus?.('Awaiting signature in Wander...');
  } else {
    onStatus?.('Publishing profile payload...');
  }

  let result;
  try {
    result = await account.updateProfile(formattedProfile, [
      { name: 'App-Name', value: 'Permissionles-Secure' },
      { name: 'App-Version', value: '1.0' },
    ]);
  } catch (err) {
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('user') || msg.includes('cancel') || msg.includes('reject') || msg.includes('denied')) {
      throw new Error('Transaction was cancelled in your browser wallet.');
    }
    throw err;
  }

  const txId = result?.id || result?.txId;
  console.log('✅ Profile published successfully! Tx ID:', txId);

  onStatus?.('Hydrating profile cache...');
  const updatedAccount = await account.get(address);

  return {
    txId,
    account: updatedAccount,
  };
}

/**
 * Uploads an image (avatar or banner) to the Arweave permaweb.
 * Returns the Arweave Transaction ID and ar:// URI.
 *
 * Expects an already cropped + compressed image (see ImageCropper / imageCompression.js).
 * For items under 100kbs, uses free ANS-104 bundler (JWK) or Wander dispatch (browser wallet).
 * For items over 100kbs (when allowOversize is true), signs a paid base-layer L1 transaction.
 *
 * @param {File|Blob} file - Image blob
 * @param {object|null} walletKey - User's JWK keyfile (null if browser wallet)
 * @param {object} [options]
 * @param {boolean} [options.allowOversize=false] - Skip the 100 KiB guard ("Upload Only" originals).
 * @param {Function} [options.onStatus=null] - Status notification callback (e.g. for UI feedback)
 * @returns {Promise<{ txId: string, uri: string, url: string }>}
 */
export async function uploadProfileMedia(file, walletKey, { allowOversize = false, onStatus = null } = {}) {
  if (!file) throw new Error('No file provided for upload.');

  // Free ANS-104 uploads are capped at 100 KiB; images are compressed upstream to ~98 KiB.
  if (!allowOversize && file.size > MAX_MEDIA_BYTES) {
    throw new Error(`Image must be under ${MAX_MEDIA_BYTES / 1024} KB after compression (got ${(file.size / 1024).toFixed(1)} KB).`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = file.type || 'image/webp';
  const isOverFreeLimit = file.size > MAX_MEDIA_BYTES;

  let txId = null;

  if (walletKey) {
    // -----------------------------------------------------------------
    // 1. JWK / In-Memory Keypair Flow (Automatic signing)
    // -----------------------------------------------------------------
    if (!isOverFreeLimit) {
      // Free ANS-104 bundler dispatch via up.arweave.net
      onStatus?.('Signing bundled upload...');
      const signer = new ArweaveSigner(walletKey);
      const dataItem = createData(buffer, signer, {
        tags: [
          { name: 'Content-Type', value: mimeType },
          { name: 'App-Name', value: 'Arweave-Account' },
          { name: 'Type', value: 'profile-media' },
        ],
      });

      await dataItem.sign(signer);

      onStatus?.('Dispatching to bundler...');
      const response = await fetch('https://up.arweave.net/tx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Accept: 'application/json',
        },
        body: dataItem.getRaw(),
      });

      if (response.status >= 200 && response.status < 300) {
        txId = dataItem.id;
      } else {
        throw new Error(`Media upload failed with status ${response.status}`);
      }
    } else {
      // Oversize image with JWK: Paid Arweave L1 transaction
      onStatus?.('Creating L1 transaction on Arweave...');
      const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);
      const tx = await arweave.createTransaction({ data: buffer }, walletKey);
      tx.addTag('Content-Type', mimeType);
      tx.addTag('App-Name', 'Arweave-Account');
      tx.addTag('Type', 'profile-media');

      onStatus?.('Signing L1 transaction...');
      await arweave.transactions.sign(tx, walletKey);

      onStatus?.('Uploading to Arweave gateway...');
      const uploader = await arweave.transactions.getUploader(tx);
      while (!uploader.isComplete) {
        await uploader.uploadChunk();
      }
      txId = tx.id;
    }
  } else if (typeof window !== 'undefined' && window.arweaveWallet) {
    // -----------------------------------------------------------------
    // 2. Browser Extension Wallet Flow (Wander)
    // -----------------------------------------------------------------
    const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);
    const tx = await arweave.createTransaction({ data: buffer });
    tx.addTag('Content-Type', mimeType);
    tx.addTag('App-Name', 'Arweave-Account');
    tx.addTag('Type', 'profile-media');

    if (!isOverFreeLimit) {
      // Under 100kbs: Free bundled dispatch
      onStatus?.('Awaiting signature in Wander...');
      try {
        const result = await window.arweaveWallet.dispatch(tx);
        txId = result.id;
      } catch (err) {
        const msg = String(err?.message || err || '').toLowerCase();
        if (msg.includes('user') || msg.includes('cancel') || msg.includes('reject') || msg.includes('denied')) {
          throw new Error('Transaction was cancelled in your browser wallet.');
        }
        throw err;
      }
    } else {
      // Over 100kbs: Paid L1 base-layer transaction requiring user signature in Wander
      onStatus?.('Awaiting signature in Wander for paid upload...');
      try {
        await arweave.transactions.sign(tx);
      } catch (err) {
        const msg = String(err?.message || err || '').toLowerCase();
        if (msg.includes('user') || msg.includes('cancel') || msg.includes('reject') || msg.includes('denied')) {
          throw new Error('Transaction was cancelled in your browser wallet.');
        }
        throw err;
      }

      onStatus?.('Uploading chunks to Arweave gateway...');
      const uploader = await arweave.transactions.getUploader(tx);
      while (!uploader.isComplete) {
        await uploader.uploadChunk();
      }
      txId = tx.id;
    }
  } else {
    throw new Error('No wallet available to sign media upload.');
  }

  return {
    txId,
    uri: `ar://${txId}`,
    url: `https://arweave.net/${txId}`,
  };
}
