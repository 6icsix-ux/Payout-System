import { configured, sb } from "./js/core/config.js";
import { route } from "./js/core/router.js";
import { state } from "./js/core/state.js";
import { loadMe } from "./js/pages/login.js";

window.addEventListener("hashchange", route);

(async () => {
  if (configured) {
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && state.me) { state.me = null; route(); }
    });
    await loadMe();
  }
  route();
})();
