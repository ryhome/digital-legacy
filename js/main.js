// Wiring. Every view is registered here so app.js never imports a view and nothing is circular.

import { boot, onLock, registerViews } from './app.js';
import * as gate from './views-gate.js';
import * as genesis from './views-genesis.js';
import * as vault from './views-vault.js';
import * as unlock from './views-unlock.js';
import { diagView } from './views-diag.js';
import { release } from './held.js';

registerViews({
  install: gate.installView,
  boot: gate.bootView,
  nostore: gate.noStorageView,
  insecure: gate.insecureView,
  diag: diagView,
  'selftest-failed': gate.selfTestFailedView,
  damaged: gate.damagedView,
  update: gate.updateView,
  lang: gate.langView,
  vaults: gate.vaultsView,

  genesis: genesis.guard(genesis.genesisView),
  'genesis-pass': genesis.guard(genesis.genesisPassView),
  'genesis-phrase': genesis.guard(genesis.genesisPhraseView),
  'genesis-derive': genesis.guard(genesis.genesisDeriveView),
  'genesis-verify': genesis.guard(genesis.genesisVerifyView),
  'genesis-create': genesis.guard(genesis.genesisCreateView),
  'genesis-done': genesis.genesisDoneView,
  print: genesis.printView,
  'print-heir': genesis.heirView,

  home: vault.homeView,
  write: vault.writeView,
  sealed: vault.sealedView,
  backup: vault.backupView,
  restore: vault.restoreView,
  settings: vault.settingsView,
  'confirm-remove': vault.confirmRemoveView,
  rekey: vault.rekeyView,
  guide: vault.guideView,

  unlock: unlock.unlockView,
  'unlock-derive': unlock.unlockDeriveView,
  read: unlock.readView,
  'confirm-delete': unlock.confirmDeleteView,
});

onLock(release);
onLock(unlock.resetUnlock);
// Backgrounding during setup: the screen is blanked like everywhere else, the phrase itself
// survives for a bounded time so a phone call does not cost the words already written down.
onLock(genesis.suspendGenesis);

// Framebusting: frame-ancestors is not available from a meta CSP, so refuse to render at all.
if (window.top !== window.self) {
  document.documentElement.replaceChildren(
    Object.assign(document.createElement('p'), {
      textContent: 'Digital Legacy will not run inside a frame.',
    }));
} else {
  boot();
}
