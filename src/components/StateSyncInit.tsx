"use client";

import { useEffect } from "react";
import { installStateSync } from "@/lib/stateSync";

/**
 * Boots cross-device state sync, once, as early as possible in the app tree.
 *
 * Sits in the root layout so it runs before the page's stores hydrate. If the
 * server has newer state than this device, `installStateSync` adopts it and asks
 * us to reload once so the stores pick up the fresh localStorage — which is why
 * this component exists separately rather than being folded into a store.
 *
 * Renders nothing. It is a no-op when `/api/state` is unavailable, so the app
 * still works as a plain per-device install.
 */
export function StateSyncInit() {
  useEffect(() => {
    installStateSync(() => {
      // Server had newer data and it has been written to localStorage; reload so
      // every store re-reads it during its normal mount.
      window.location.reload();
    });
  }, []);

  return null;
}

export default StateSyncInit;
