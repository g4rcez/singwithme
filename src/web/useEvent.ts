import { useCallback, useEffect, useState } from "react";
import type { EventState } from "../shared/types";
import { api } from "./api";

const POLL_MS = 2500;

export interface LiveEvent {
  state: EventState | null;
  /** Set when the event cannot be loaded (deleted, wrong link). */
  error: string | null;
  refresh: () => Promise<void>;
}

/** Live view of an event's duos and queue. Polls, since phones and the host change it independently. */
export function useEvent(eventId: string | null): LiveEvent {
  const [state, setState] = useState<EventState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!eventId) return;
    await api.event(eventId).then(
      (loaded) => {
        setState(loaded);
        setError(null);
      },
      (cause: Error) => setError(cause.message),
    );
  }, [eventId]);

  useEffect(() => {
    setState(null);
    void refresh();
    // Background tabs do not need to keep asking.
    const timer = setInterval(() => document.visibilityState === "visible" && void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { state, error, refresh };
}
