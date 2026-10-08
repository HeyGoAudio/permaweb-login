# Decentralized & Permissionless Arweave Authentication Specification

> **Version:** 0.2  
> **Status:** Implemented & Verified  
> **Repository:** `Permissionles-Secure`  
> **Network:** Arweave Permaweb  

---

## 1. Executive Summary & Design Philosophy

This specification details the cryptographic architecture, storage format, and authentication workflows of **Permissionles-Secure**—a fully client-side, non-custodial authentication system designed for the Arweave permaweb.

### The Architectural Dilemma
In traditional Web2 architectures, user authentication relies on centralized databases (e.g., PostgreSQL, Firebase, AWS Cognito). The server stores password hashes (bcrypt, argon2) and serves as the gatekeeper. Users can easily reset passwords because data rows are mutable.

On **Arweave**, data is:
1. **Permanent & Immutable:** Uploaded data cannot be edited, overwritten, or deleted.
2. **Public:** All transaction headers, tags, and data items are accessible to anyone querying gateways or GraphQL.
3. **Permissionless:** Anyone can post arbitrary data tagged with any label.

Building a secure "email + password" login on a public, immutable ledger without a backend server presents serious cryptographic and architectural challenges:
* How do you store an encrypted private key without exposing the user's wallet address?
* How do you allow the user to locate their account without exposing their email to rainbow tables or public enumeration?
* How do you prevent attackers from squatting or polluting user accounts on a permissionless network?
* How do you protect against infinite offline brute-force cracking of ciphertexts?
* How do you handle password changes when past data is permanent?

The following sections define how this system resolves every one of these problems using modern cryptographic primitives.

---

## 2. Cryptographic Primitives & Parameters

```
                                USER CREDENTIALS
                           (Email Address, Password)
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │    Input Normalization &      │
                      │  Entropy Validation (>=10 ch) │
                      └───────────────┬───────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
   [Account-ID Derivation]                         [Payload Encryption Key]
              │                                               │
  SHA-256("arweave-account-tag:" + email)        CSPRNG 16-byte Random Salt
         (First 16 bytes)                                     │
              │                                               ▼
              ▼                                   Argon2id Key Derivation
    Argon2id Tag Derivation                       (32 MiB RAM, 3 iterations)
    (32 MiB RAM, 3 iterations)                                │
              │                                               ▼
              ▼                                       AES-256-GCM Key
     HMAC-SHA256 Expansion                                    │
              │                                               ▼
              ▼                                    AES-256-GCM Encrypt
    64-char Hex Search Tag                          (12-byte CSPRNG IV)
        (Account-ID)                                          │
              │                                               ▼
              │                                    Encrypted Wallet Envelope
              │                                   { kdf, salt, iv, ciphertext }
              │                                               │
              └───────────────────────┬───────────────────────┘
                                      │
                                      ▼
                        ANS-104 Data Item Packaging
                    (Signed by Disposable Ephemeral Key)
                                      │
                                      ▼
                           Dispatch to Permaweb
                           (https://up.arweave.net)
```

### 2.1 Memory-Hard Key Derivation Function (Argon2id)
* **Algorithm:** Argon2id (hybrid version of Argon2, resistant to both side-channel and GPU/ASIC attacks).
* **Library:** `hash-wasm` (compiled to WebAssembly for browser performance).
* **Parameters:**
  * **Memory Cost (`m`):** $32,768\text{ KiB}$ ($32\text{ MiB}$).
  * **Time Cost (`t`):** $3\text{ iterations}$.
  * **Parallelism (`p`):** $1\text{ thread}$.
  * **Output Length:** $32\text{ bytes}$ ($256\text{ bits}$).
* **Rationale:** PBKDF2 has negligible memory overhead ($O(1)$ RAM), allowing modern GPU rigs to evaluate hundreds of millions of candidate hashes per second. Argon2id forces the cracker to allocate $32\text{ MiB}$ of high-speed memory per thread, making parallel dictionary cracking prohibitively expensive.

### 2.2 Authenticated Encryption (AES-256-GCM)
* **Algorithm:** AES-GCM (Galois/Counter Mode).
* **Key Length:** $256\text{ bits}$ (derived from Argon2id).
* **Initialization Vector (IV):** $12\text{ bytes}$ generated per encryption operation via `window.crypto.getRandomValues`.
* **Salt:** $16\text{ bytes}$ generated per encryption operation via `window.crypto.getRandomValues`.
* **Authentication Tag:** $128\text{ bits}$ (standard GCM tag).
* **Rationale:** AES-GCM provides both confidentiality and cryptographic integrity. If ciphertext, IV, or key is modified or incorrect, decryption throws an authentication error immediately.

### 2.3 Deterministic Tag Derivation (`Account-ID`)
To enable account discovery on Arweave GraphQL without storing plaintext emails or allowing precomputed rainbow tables:
1. **Email Normalization:** `emailNorm = email.trim().toLowerCase()`
2. **Deterministic Salt:** 
   $$\text{tagSalt} = \text{SHA-256}(\text{"arweave-account-tag:"} \mathbin{\Vert} \text{emailNorm})[0..16]$$
3. **Memory-Hard Secret Derivation:**
   $$\text{seed} = \text{Argon2id}(\text{password}, \text{tagSalt}, m=32768, t=3, p=1, \text{len}=32)$$
4. **Domain-Separated Expansion:**
   $$\text{tagBuffer} = \text{HMAC-SHA-256}(\text{key}=\text{seed}, \text{data}=\text{"arweave-account-id-v1"})$$
5. **Formatting:** Converted to a 64-character lowercase hexadecimal string.
* **Security Properties:**
  * **Zero Enumeration:** An attacker who knows a target's email cannot compute their `Account-ID` without also guessing the password through memory-hard Argon2id.
  * **Zero Rainbow Tables:** Precomputing hashes of leaked email databases is impossible because of the password dependency and memory hardness.
  * **100% Deterministic:** Legitimate users entering the same `(email, password)` will always re-derive the exact same 64-character string.

### 2.4 Client-Side Password Entropy Gate
Before allowing encryption or key derivation, `CryptoService.validatePassword(password)` enforces:
* Minimum length of **10 characters**.
* Character diversity: must contain at least 3 of the 4 character classes (uppercase, lowercase, digits, symbols), or be $\ge 14\text{ characters}$ long.

---

## 3. Account Creation & Key Generation

The registration workflow is implemented across [`src/components/CreateAccount.jsx`](file:///home/superfreak/Desktop/Permissionles-Secure/src/components/CreateAccount.jsx) and [`src/components/PasswordSetup.jsx`](file:///home/superfreak/Desktop/Permissionles-Secure/src/components/PasswordSetup.jsx):

```
                      CREATE ACCOUNT WORKFLOW
                      
[User: "Generate Key"]
         │
         ▼
 1. Arweave.wallets.generate()  ──► Generates RSA-4096 JWK
         │
         ▼
 2. Arweave.wallets.jwkToAddress(jwk) ──► Derives 43-char Public Address
         │
         ▼
 3. Offer Unencrypted Download ──► Users can opt for full self-custody
         │
         ▼
[User: "Continue with password ⚠️"]
         │
         ▼
 4. Security Warning Modal Opens
    - Full explanation of permanent public storage
    - No password reset warning
    - Offline cracking risk
    - Option: "Download Key File Now" (Self-Custody)
    - Radio Button: "I understand"
         │
         ▼ (Must check radio)
 5. "Agree & Continue" button renders
         │
         ▼
 6. Enter (Email, Password, ConfirmPassword)
         │
         ▼
 7. Proceed to Packaging & Upload (Section 4)
```

---

## 4. Storage & ANS-104 Packaging Specification

### 4.1 Encrypted Payload Envelope
The user's private RSA JWK is serialized to JSON and encrypted using `CryptoService.encrypt(walletKey, password)`. The resulting envelope has the following schema:

```json
{
  "kdf": "argon2id",
  "memorySize": 32768,
  "iterations": 3,
  "salt": "<Base64 encoded 16-byte salt>",
  "iv": "<Base64 encoded 12-byte IV>",
  "ciphertext": "<Base64 encoded AES-256-GCM ciphertext + 16-byte tag>"
}
```

### 4.2 Ephemeral Envelope Signer (Wallet Anonymization)
In the ANS-104 bundled data specification, every data item contains the public key of the signer in its binary header (`owner` field). Anyone inspecting the transaction can convert this public key to an address via `arweave.wallets.ownerToAddress(dataItem.owner)`.

* **Vulnerability Identified:** If the data item is signed using `new ArweaveSigner(walletKey)`, the user's actual wallet address is permanently exposed in plaintext on Arweave, tying their on-chain wallet history directly to the `Account-ID`.
* **Implementation:** The client creates a **disposable, ephemeral Arweave keypair** purely to sign the ANS-104 wrapper:
  ```javascript
  const ephemeralKey = await arweave.wallets.generate();
  const signer = new ArweaveSigner(ephemeralKey);
  ```
* **Result:** The `owner` field on Arweave points to a throwaway address with zero transactions and zero balance. The user's actual `walletKey` exists strictly inside the encrypted payload.

### 4.3 ANS-104 Tags Schema
The bundled data item is assigned the following tags:

| Tag Name | Value | Purpose |
| :--- | :--- | :--- |
| `App-Name` | `Arweave-Login` | Application identifier for GraphQL filtering. |
| `Account-ID` | `<64-char hex>` | The deterministic Argon2id tag derived from `(email, password)`. |
| `Content-Type` | `application/json` | MIME type of the serialized envelope. |
| `Account-Version` | `0.2` | Protocol version (`0.2` indicates Argon2id; `0.1` indicates legacy PBKDF2). |
| `KDF` | `Argon2id` | Explicit cryptographic metadata tag. |

### 4.4 Permaweb Dispatch
The binary data item is dispatched to the Turbo bundler endpoint:
```http
POST https://up.arweave.net/tx
Content-Type: application/octet-stream
Accept: application/json

<dataItem.getRaw() binary payload>
```

---

## 5. Account Resolution & Login Specification

The authentication workflow is implemented in [`src/utils/account.js`](file:///home/superfreak/Desktop/Permissionles-Secure/src/utils/account.js) and [`src/components/Login.jsx`](file:///home/superfreak/Desktop/Permissionles-Secure/src/components/Login.jsx):

```
                        LOGIN WORKFLOW
                        
User inputs: (Email, Password)
             │
             ▼
1. CryptoService.deriveAccountId(email, password) ──► Recomputes 64-char Account-ID
             │
             ▼
2. Query https://arweave.net/graphql
   TagFilter: { App-Name: 'Arweave-Login', Account-ID: accountId }
   first: 10, sort: HEIGHT_DESC
             │
             ▼
3. Candidate Transaction IDs: [tx1, tx2, ..., txN]
             │
             ▼
4. Multi-Candidate Decryption Loop (Anti-Squatting / Anti-DoS):
   FOR EACH txId IN candidates:
       ├─ Fetch envelope from gateway mirrors (arweave.net, up.arweave.net, etc.)
       ├─ Attempt AES-256-GCM decrypt with password
       │     ├─ Success? ──► Unpack JWK, derive address, RETURN session
       │     └─ Tag Check Fails? (Squatted/malformed tx) ──► Log warning & CONTINUE
             │
             ▼
5. All candidates failed or none found?
   Throw: "Incorrect password or account not found."
```

### 5.1 Mitigation of Denial-of-Service via Squatting
Because Arweave is permissionless, any third party could post arbitrary data tagged with a victim's `Account-ID`.
* **Legacy Vulnerability:** If the query retrieves only `first: 1`, an attacker's fake transaction could shadow the legitimate user's transaction, locking them out permanently.
* **Solution Implemented:**
  1. Retrieve up to 10 candidates (`first: 10, sort: HEIGHT_DESC`).
  2. Test each candidate against AES-GCM decryption.
  3. Because AES-GCM includes an authenticated tag, fake or squatted transactions fail authentication instantly without corrupting the app state. The loop transparently skips attackers' payloads until the authentic transaction is verified.

### 5.2 Supported Login Alternatives
1. **Credentials Login:** Email + Password (reconstructs search tag, queries GraphQL, unlocks JWK).
2. **Browser Wallet Extension:** Wander / ArConnect (`window.arweaveWallet.connect()`).
3. **Direct Keyfile Upload:** Allows users to drag-and-drop or upload their raw `arweave-keyfile.json` directly into the browser. The client parses the JWK, validates RSA parameters, derives the address, and initializes the session without network calls.

---

## 6. Key Rotation & Migration Protocol

On an immutable ledger like Arweave, **password rotation without key rotation is a security illusion**. If a user changes their password because the old one was compromised, an attacker can still locate the older on-chain transaction and crack the old password to steal the same underlying key.

### The Migration Protocol
When a user updates their credentials:
1. **Fresh Identity:** Generate a new Arweave keypair (`newWalletKey`, `newAddress`).
2. **Asset Sweep:** Check the balance of the old address:
   ```javascript
   const balanceWinston = await arweave.wallets.getBalance(oldAddress);
   ```
   If balance $> 0$, create an on-chain transfer sending `balance - fee` from `oldAddress` to `newAddress` signed by `oldWalletKey`.
3. **Encryption & Storage:** Encrypt `newWalletKey` under `newPassword`, derive the new `Account-ID`, sign with an ephemeral key, and upload to Arweave.
4. **Decommissioning Notice:** Display a migration receipt showing:
   $$\text{Old Address (Decommissioned)} \longrightarrow \text{New Address (Active)}$$
   Prompt the user to download a backup of the new keyfile.

---

## 7. Vulnerability Assessment & Mitigation Matrix

| # | Vulnerability | Severity | Root Cause | Implemented Mitigation |
| :- | :--- | :--- | :--- | :--- |
| **1** | **Public Exposure of Wallet Address** | **Critical** | ANS-104 bundle header stores signer's unencrypted public key in `owner` field. | ANS-104 bundles are signed with a **throwaway ephemeral keypair**. The user's actual wallet JWK is exclusively stored encrypted inside the payload. |
| **2** | **Email Rainbow Tables & Enumeration** | **High** | `Account-ID` was calculated as unsalted `SHA-256(email)`. | `Account-ID` is now derived from `Argon2id(password, salt(email))`. Without the password, observers cannot calculate the tag or determine if an account exists. |
| **3** | **DoS via Account Squatting / Shadowing** | **High** | GraphQL query retrieved `first: 1` matching tag without signature validation. | GraphQL queries up to 10 candidates. Decryption loops through candidates; AES-GCM authentication automatically rejects and bypasses attackers' dummy payloads. |
| **4** | **Offline Brute-Force on Ciphertext** | **Critical** | PBKDF2 (250,000 iterations) has $O(1)$ memory cost; AES-GCM acts as a fast verification oracle. | Replaced PBKDF2 with **Argon2id** ($32\text{ MiB}$ memory cost, 3 iterations) and added client-side password entropy validation ($\ge 10$ chars with character variety). |
| **5** | **Immutability Conflicts on Password Change** | **High** | Arweave is write-only; re-encrypting the same JWK leaves older transactions readable forever. | Implemented a **Wallet Migration Protocol**: credential updates generate a new Arweave keypair and sweep funds from the old wallet to the new one. |

---

## 8. Codebase Architecture & File Mapping

```
src/
├── utils/
│   ├── crypto.js          # Core Cryptographic Service: Argon2id, AES-GCM, deriveAccountId
│   ├── account.js         # Arweave GraphQL search, multi-candidate unlock, getWalletBalance, downloadKeyfile
│   └── config.js          # Arweave gateway configurations
├── components/
│   ├── LandingScreen.jsx  # Main dashboard: AR balance panel, copy address, download keyfile
│   ├── Login.jsx          # Unified login: Email+Password, Wander extension, Keyfile upload
│   ├── CreateAccount.jsx  # Wallet generation, security warning modal with self-custody options
│   ├── PasswordSetup.jsx  # Argon2id encryption & upload with ephemeral envelope signer
│   └── RotateCredentials.jsx # Immutability-compliant key rotation & asset migration workflow
├── App.jsx                # Root view router, user session state, header balance indicator
└── index.css              # Glassmorphic design tokens, responsive breakpoints (<600px), modal styles
```

---

## 9. Security Best Practices for Integrators

1. **Gateways:** Always restrict GraphQL lookups to trusted, indexing gateways (e.g., `https://arweave.net/graphql`).
2. **Keyfile Custody:** Users should always be encouraged to keep a local JSON backup of their raw keyfile.
3. **Environment Isolation:** Keys and passwords must never be stored in `localStorage` or `sessionStorage` in plaintext. The session in memory should only retain keys while the tab remains open.
