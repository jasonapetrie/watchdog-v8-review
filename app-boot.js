(function () {
  'use strict';

  async function signOutToPublic() {
    await window.WatchdogAuth.signOut();
    window.location.replace('index.html');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const gate = document.getElementById('authGate');
    const result = await window.WatchdogAuth.requireActiveSession();

    if (!result) {
      // requireActiveSession() already redirected to login.html.
      return;
    }

    if (result.schemaMissing) {
      gate.hidden = true;
      document.getElementById('schemaMissingNotice').hidden = false;
      document.getElementById('schemaMissingSignOut').addEventListener('click', signOutToPublic);
      return;
    }

    const S = window.WatchdogSecurity;
    S.setText(document.getElementById('hdrUserDisplay'), result.profile.display_name);
    S.setText(document.getElementById('hdrUserRole'), result.profile.role);
    document.getElementById('signOutBtn').addEventListener('click', signOutToPublic);

    gate.hidden = true;
    document.getElementById('appRoot').hidden = false;

    await window.WatchdogDashboardBoot(result.user.id, result.profile.role);
  });
})();
