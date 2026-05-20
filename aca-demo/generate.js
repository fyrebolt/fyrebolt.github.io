// generate.js — local-only signing script for the ACA membership .pkpass.
//
// IMPORTANT: The `certs/` folder contains your Apple Pass Type ID certificate
// and private key. It is gitignored and MUST NEVER be committed. Do not check
// in any .p12, .pem, or .key files. Only the final signed passes/*.pkpass
// gets committed.
//
// Usage:
//   npm install node-passkit-generator
//   node generate.js
//   node generate.js --name "John Smith" --id "ACA-2025-042"
//
// Expected layout:
//   aca-demo/
//     pass-model/        (pass.json + icons + logos)
//     certs/
//       signerCert.pem   (your Pass Type ID cert, PEM)
//       signerKey.pem    (matching private key, PEM — may be passphrase-protected)
//       wwdr.pem         (Apple WWDR intermediate cert)
//     passes/            (output)

const fs = require("fs");
const path = require("path");
const { PKPass } = require("passkit-generator");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") out.name = argv[++i];
    else if (a === "--id") out.id = argv[++i];
    else if (a === "--passphrase") out.passphrase = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const root = __dirname;
  const modelDir = path.join(root, "pass-model");
  const certsDir = path.join(root, "certs");
  const outDir = path.join(root, "passes");

  const signerCert = fs.readFileSync(path.join(certsDir, "signerCert.pem"));
  const signerKey = fs.readFileSync(path.join(certsDir, "signerKey.pem"));
  const wwdr = fs.readFileSync(path.join(certsDir, "wwdr.pem"));

  const pass = await PKPass.from(
    {
      model: modelDir,
      certificates: {
        wwdr,
        signerCert,
        signerKey,
        signerKeyPassphrase: args.passphrase || process.env.PASS_KEY_PASSPHRASE || undefined,
      },
    },
    {
      // Overrides — applied on top of pass.json
      serialNumber: args.id || "ACA-2025-001",
    }
  );

  if (args.name) {
    pass.primaryFields.splice(0, pass.primaryFields.length);
    pass.primaryFields.push({ key: "member", label: "MEMBER", value: args.name });
  }
  if (args.id) {
    pass.secondaryFields.splice(0, pass.secondaryFields.length);
    pass.secondaryFields.push({ key: "memberId", label: "MEMBER ID", value: args.id });
    pass.setBarcodes({
      format: "PKBarcodeFormatQR",
      message: args.id,
      messageEncoding: "iso-8859-1",
      altText: args.id,
    });
  }

  const buffer = pass.getAsBuffer();
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "membership.pkpass");
  fs.writeFileSync(outPath, buffer);

  console.log("✓ Signed pass written to:", outPath);
  console.log("  Size:", buffer.length, "bytes");
}

main().catch((err) => {
  console.error("✗ Failed to generate pass:", err);
  process.exit(1);
});
