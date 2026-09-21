// OpenAI bearer credentials must never be shipped in public release assets.
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function preparePublicConfig(context) {
  const root = context.appDir || context.packager.projectDir;
  const source = JSON.parse(fs.readFileSync(path.join(root, 'config/config.json'), 'utf8'));
  // Firebase web configuration and native Google OAuth client configuration are
  // public client identifiers. Whitelist them rather than copying future secrets.
  const config = { firebase: source.firebase, google: source.google, adminEmails: source.adminEmails || [], openai: { apiKey: '' } };
  const output = path.join(root, 'artifacts/public-release-config');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'config.json'), JSON.stringify(config, null, 2));
  fs.copyFileSync(path.join(root, 'config/config.example.json'), path.join(output, 'config.example.json'));
};
