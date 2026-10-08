import { argon2id } from 'hash-wasm';

export class CryptoService {
  /**
   * Derive an AES-GCM CryptoKey from a password and salt using memory-hard Argon2id.
   * Uses 32 MiB of RAM and 3 iterations to thwart offline GPU/ASIC cracking.
   */
  static async deriveAesKey(password, saltUint8) {
    const rawKey = await argon2id({
      password,
      salt: saltUint8,
      parallelism: 1,
      iterations: 3,
      memorySize: 32768, // 32 MiB memory cost
      hashLength: 32,    // 256-bit AES key
      outputType: 'binary'
    });

    return window.crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Legacy PBKDF2 derivation kept for backward-compatibility with older test payloads.
   */
  static async deriveKeyPBKDF2(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 250000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Convert an ArrayBuffer or Uint8Array to a Base64 string.
   */
  static bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Convert a Base64 string back to an ArrayBuffer.
   */
  static base64ToBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Validates client-side password entropy to protect against brute-force attacks.
   */
  static validatePassword(password) {
    if (!password || typeof password !== 'string') {
      return { valid: false, message: 'Password is required.' };
    }
    if (password.length < 10) {
      return { valid: false, message: 'Password must be at least 10 characters long.' };
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    const varietyCount = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;

    if (varietyCount < 3 && password.length < 14) {
      return {
        valid: false,
        message: 'Password must contain a mix of uppercase, lowercase, numbers, or symbols (or be at least 14 characters).'
      };
    }
    return { valid: true };
  }

  /**
   * Deterministically derive an Account-ID tag from email and password.
   * Memory-hard Argon2id derivation ensures an attacker cannot enumerate accounts
   * or perform rainbow-table attacks without already knowing the password.
   */
  static async deriveAccountId(email, password) {
    const enc = new TextEncoder();
    const emailNorm = email.trim().toLowerCase();

    // Derive deterministic 16-byte salt from normalized email
    const emailBuffer = enc.encode(`arweave-account-tag:${emailNorm}`);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', emailBuffer);
    const tagSalt = new Uint8Array(hashBuffer).slice(0, 16);

    // Memory-hard Argon2id key generation
    const derivedBytes = await argon2id({
      password,
      salt: tagSalt,
      parallelism: 1,
      iterations: 3,
      memorySize: 32768,
      hashLength: 32,
      outputType: 'binary'
    });

    // HMAC expansion for domain separation
    const hmacKey = await window.crypto.subtle.importKey(
      'raw',
      derivedBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const tagBuffer = await window.crypto.subtle.sign(
      'HMAC',
      hmacKey,
      enc.encode('arweave-account-id-v1')
    );

    const hashArray = Array.from(new Uint8Array(tagBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Encrypt data using AES-GCM and Argon2id derived key.
   */
  static async encrypt(data, password) {
    const enc = new TextEncoder();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const key = await this.deriveAesKey(password, salt);
    const encodedData = enc.encode(JSON.stringify(data));

    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encodedData
    );

    return {
      kdf: 'argon2id',
      memorySize: 32768,
      iterations: 3,
      salt: this.bufferToBase64(salt),
      iv: this.bufferToBase64(iv),
      ciphertext: this.bufferToBase64(ciphertext)
    };
  }

  /**
   * Decrypt a ciphertext envelope back to original JSON object.
   * Seamlessly supports Argon2id envelopes and falls back to legacy PBKDF2 envelopes.
   */
  static async decrypt(encryptedData, password) {
    const saltBuffer = this.base64ToBuffer(encryptedData.salt);
    const saltUint8 = new Uint8Array(saltBuffer);
    const iv = this.base64ToBuffer(encryptedData.iv);
    const ciphertext = this.base64ToBuffer(encryptedData.ciphertext);

    if (encryptedData.kdf === 'argon2id') {
      const key = await this.deriveAesKey(password, saltUint8);
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );
      const dec = new TextDecoder();
      return JSON.parse(dec.decode(decryptedBuffer));
    }

    // Fallback: If no kdf tag or legacy envelope, try Argon2id then legacy PBKDF2
    try {
      const key = await this.deriveAesKey(password, saltUint8);
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );
      const dec = new TextDecoder();
      return JSON.parse(dec.decode(decryptedBuffer));
    } catch {
      // Legacy PBKDF2 attempt
      const legacyKey = await this.deriveKeyPBKDF2(password, saltBuffer);
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        legacyKey,
        ciphertext
      );
      const dec = new TextDecoder();
      return JSON.parse(dec.decode(decryptedBuffer));
    }
  }

  /**
   * @deprecated Insecure legacy method. Use deriveAccountId(email, password) instead.
   */
  static async hashEmail(email) {
    const enc = new TextEncoder();
    const data = enc.encode(email.trim().toLowerCase());
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
