# ACA Apple Wallet Demo

A static "Add to Apple Wallet" landing page for the **Association of Chinese
Americans at UCLA** membership card demo. The page is served from
`fyrebolt.github.io/aca-demo/` and links to a pre-signed `.pkpass` file that
lives under `passes/`.

There is **no server, no CI, no build step**. The pass is generated locally on
your Mac with `generate.js`, the resulting `.pkpass` is committed, and GitHub
Pages serves it.

---

## 1. Apple Developer setup (one time)

You need an Apple Developer account ($99/yr).

1. Go to
   [developer.apple.com → Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list).
2. Click **+**, choose **Pass Type IDs**, and register one — for example
   `pass.org.aca.ucla.membership`. Note this exact string.
3. Open the Pass Type ID you just made, click **Create Certificate**, and
   follow Apple's CSR flow:
   - Open **Keychain Access** on your Mac.
   - Menu: **Keychain Access → Certificate Assistant → Request a Certificate
     From a Certificate Authority…**
   - Email = your Apple ID email, Common name = `ACA Pass Cert`,
     "Saved to disk" — save the `.certSigningRequest`.
   - Upload that CSR in the Apple dashboard, download the `pass.cer`.
4. Double-click `pass.cer` to import it into Keychain.
5. Note your **Team ID** at the top right of the developer portal (10-char
   string like `ABCDE12345`).

## 2. Export the certificate as `.p12`

In **Keychain Access**:

1. Find the certificate named *"Pass Type ID: pass.org.aca.ucla.membership"*
   (or whatever yours is called) under **My Certificates** in the **login**
   keychain.
2. Expand the disclosure arrow — there must be a private key under it. If
   not, you imported the cert on a different machine; redo step 1.3 on this
   Mac.
3. Right-click the certificate → **Export "Pass Type ID: …"** → save as
   `aca-pass.p12`. Set a passphrase you'll remember.

## 3. Convert `.p12` to PEM files

```bash
cd aca-demo
mkdir -p certs
mv ~/Downloads/aca-pass.p12 certs/aca-pass.p12

# Private key (will prompt for the .p12 passphrase, then a new PEM passphrase)
openssl pkcs12 -in certs/aca-pass.p12 -nocerts -out certs/signerKey.pem -legacy

# Public cert
openssl pkcs12 -in certs/aca-pass.p12 -clcerts -nokeys -out certs/signerCert.pem -legacy
```

If `openssl` complains without `-legacy`, you have OpenSSL 3 — keep the flag.

## 4. Apple WWDR intermediate certificate

Download **Worldwide Developer Relations - G4** from
<https://www.apple.com/certificateauthority/> (the `AppleWWDRCAG4.cer` file).

Convert to PEM:

```bash
openssl x509 -inform der -in ~/Downloads/AppleWWDRCAG4.cer -out certs/wwdr.pem
```

You should now have:

```
aca-demo/certs/
  aca-pass.p12       # source, optional to keep
  signerCert.pem
  signerKey.pem      # passphrase-protected
  wwdr.pem
```

**These never get committed.** `.gitignore` already excludes them.

## 5. Fill in placeholders in `pass.json`

Open [pass-model/pass.json](pass-model/pass.json) and replace:

- `PASS_TYPE_ID_PLACEHOLDER` → e.g. `pass.org.aca.ucla.membership`
- `TEAM_ID_PLACEHOLDER` → your 10-char Apple Team ID

## 6. Replace the placeholder art (recommended)

The repo ships with simple red `ACA` placeholder PNGs so the build doesn't
fail. Swap them for real ACA branding at these exact dimensions:

| File | Size (px) |
| --- | --- |
| `pass-model/icon.png` | 29 × 29 |
| `pass-model/icon@2x.png` | 58 × 58 |
| `pass-model/logo.png` | 160 × 50 |
| `pass-model/logo@2x.png` | 320 × 100 |

## 7. Install deps and generate the pass

```bash
cd aca-demo
npm init -y
npm install passkit-generator

# default: Jane Doe / ACA-2025-001
node generate.js

# or override member info:
node generate.js --name "John Smith" --id "ACA-2025-042"

# if your signer key has a passphrase:
PASS_KEY_PASSPHRASE='your-passphrase' node generate.js
# or:
node generate.js --passphrase 'your-passphrase'
```

A signed file will be written to:

```
aca-demo/passes/membership.pkpass
```

Drag it into the Simulator or AirDrop to your iPhone to test.

## 8. Deploy

```bash
git add aca-demo/passes/membership.pkpass aca-demo/pass-model/pass.json
git commit -m "chore: update ACA membership pass"
git push origin main
```

Wait ~30s for GitHub Pages, then open:

<https://fyrebolt.github.io/aca-demo/>

Tap **Add to Apple Wallet** on an iPhone.

---

## Troubleshooting

- **"Sorry, your Pass cannot be installed to Passbook at this time."**
  Almost always: signing identity mismatch. Re-check `passTypeIdentifier`
  and `teamIdentifier` in `pass.json` match the cert in `certs/`.
- **`Error: PEM routines:get_name:no start line`** — your key/cert wasn't
  exported correctly. Re-run the `openssl pkcs12` commands.
- **Icons missing in Wallet** — `icon.png` and `icon@2x.png` are required;
  Wallet silently rejects passes without them.
- **GitHub Pages serves the `.pkpass` as `application/octet-stream`** — that's
  fine; iOS Safari sniffs it as a pass. If you ever switch hosts, make sure
  the MIME type is `application/vnd.apple.pkpass`.
