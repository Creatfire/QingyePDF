// Installer hooks (build/installer.nsh): --register-file-types=pdf,md · --refresh-file-types ·
// --unregister-file-types. They update the per-user "Open with" entries and exit without a window.
'use strict';
const { createAssociations } = require('./file-associations.cjs');

/** The installer hook in the argument list, or undefined for a normal launch. */
const taskIn = argv => argv.find(arg => /^--(?:register|refresh|unregister)-file-types(?:=|$)/.test(arg));

async function run(task, { app, shell }) {
  const associations = createAssociations({ app, shell }); let code = 0;
  try {
    if (task.startsWith('--unregister')) await associations.unregister();
    else if (task.startsWith('--refresh')) { const { types } = await associations.status(); const kinds = Object.keys(types).filter(k => types[k].registered); if (kinds.length) await associations.register(kinds); }
    else { const kinds = (task.split('=')[1] || 'pdf,md').split(',').filter(k => associations.TYPES[k]); if (kinds.length) await associations.register(kinds); }
  } catch { code = 1; }
  app.exit(code);
}

module.exports = { taskIn, run };
