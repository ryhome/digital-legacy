// Runs during HTML parsing, before the module graph is fetched or evaluated.
//
// beforeinstallprompt fires once, and Chrome fires it as soon as it has decided the app is
// installable. On a repeat visit — warm service worker, cached manifest — that decision can
// land before a deferred module script has finished loading, and an event nobody is listening
// for is gone for good. That leaves the install button disabled with nothing to explain it.
//
// Classic script, no defer, no module: this must be the first thing that runs.
(function () {
  var state = { prompt: null, fired: false, installed: false, at: null };
  window.__dmInstall = state;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();               // the app offers its own button rather than Chrome's bar
    state.prompt = e;
    state.fired = true;
    state.at = Math.round(performance.now());
    if (typeof window.__dmOnInstallPrompt === 'function') window.__dmOnInstallPrompt(e);
  });

  window.addEventListener('appinstalled', function () {
    state.installed = true;
    state.prompt = null;
  });
})();
