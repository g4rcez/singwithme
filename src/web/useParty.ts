import { useCallback, useEffect, useState } from "react";
import type { PartyState } from "../shared/types";
import { api } from "./api";

const POLL_MS = 2000;

/** Live view of the duos and the queue. Polls, since phones and the host change it independently. */
export function useParty(): { party: PartyState | null; refresh: () => Promise<void> } {
  const [party, setParty] = useState<PartyState | null>(null);
  const refresh = useCallback(() => api.party().then(setParty, () => undefined), []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { party, refresh };
}
