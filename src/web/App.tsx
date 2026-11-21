import { useCallback, useEffect, useState } from "react";
import type { Me, Performance } from "../shared/types";
import { api } from "./api";
import { Guest } from "./Guest";
import { Home } from "./Home";
import { Library } from "./Library";
import { Login } from "./Login";
import { Party } from "./Party";
import { Player } from "./Player";
import { PerformanceTable } from "./Ranking";
import { useEvent } from "./useEvent";

type EventTab = "songs" | "party" | "history";

type Route =
  | { page: "home" }
  | { page: "guest"; token: string | null }
  | { page: "event"; eventId: string; tab: EventTab }
  | { page: "sing"; eventId: string; songId: string; item: string | null };

function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.split("?");
  const [, first, second, third, fourth] = path.split("/").map(decodeURIComponent);
  if (first === "join" && second) return { page: "guest", token: second };
  if (first === "me") return { page: "guest", token: null };
  if (first === "e" && second) {
    if (third === "sing" && fourth) {
      return { page: "sing", eventId: second, songId: fourth, item: new URLSearchParams(query).get("item") };
    }
    return { page: "event", eventId: second, tab: third === "party" || third === "history" ? third : "songs" };
  }
  return { page: "home" };
}

const TABS: { tab: EventTab; label: string }[] = [
  { tab: "songs", label: "Músicas" },
  { tab: "party", label: "Fila e duplas" },
  { tab: "history", label: "Histórico" },
];

function History({ eventId }: { eventId: string }) {
  const [entries, setEntries] = useState<Performance[] | null>(null);
  useEffect(() => {
    api.eventHistory(eventId).then(setEntries, () => setEntries([]));
  }, [eventId]);
  return (
    <main className="card p-6">
      <h1 className="mb-1 text-xl font-bold">Histórico do evento</h1>
      <p className="mb-4 text-sm text-white/50">Tudo o que foi cantado, na ordem em que aconteceu.</p>
      {entries && <PerformanceTable entries={entries} ranked={false} showSong />}
    </main>
  );
}

/** The host's view of one event: its songs, its queue and what has been sung. */
function EventPages({ eventId, tab, me }: { eventId: string; tab: EventTab; me: Me }) {
  const { state, error, refresh } = useEvent(eventId);
  const [busy, setBusy] = useState(false);

  if (error && !state) {
    return (
      <div className="grid h-screen place-items-center text-center">
        <div>
          <p className="mb-4">{error}</p>
          <a className="btn" href="#/">
            Voltar aos eventos
          </a>
        </div>
      </div>
    );
  }
  if (!state) return <p className="p-10 text-white/50">Carregando...</p>;

  const { event } = state;
  const open = event.status === "open";
  const setStatus = async (status: "open" | "closed") => {
    if (status === "closed" && !confirm("Encerrar o evento? A fila é esvaziada e o histórico fica guardado.")) return;
    setBusy(true);
    await api.setEventStatus(eventId, status).catch(() => undefined);
    await refresh();
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <div className="min-w-0">
          <a href="#/" className="text-xs text-white/50 hover:text-white">
            ← {event.groupName}
          </a>
          <h1 className="truncate text-2xl font-black tracking-tight">
            {event.name} {!open && <span className="chip align-middle">Encerrado</span>}
          </h1>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          {TABS.map((item) => (
            <a
              key={item.tab}
              href={`#/e/${eventId}/${item.tab}`}
              className={`btn ${tab === item.tab ? "border-glow" : ""}`}
            >
              {item.label}
              {item.tab === "party" && state.queue.length > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-xs">{state.queue.length}</span>
              )}
            </a>
          ))}
          <button className="btn" disabled={busy} onClick={() => setStatus(open ? "closed" : "open")}>
            {open ? "Encerrar evento" : "Reabrir evento"}
          </button>
        </nav>
      </header>
      {tab === "history" ? (
        <History eventId={eventId} />
      ) : tab === "party" ? (
        <Party state={state} refresh={refresh} />
      ) : (
        <Library eventId={eventId} groupId={event.groupId} demo={me.demo} open={open} />
      )}
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [me, setMe] = useState<Me | null>(null);

  const loadMe = useCallback(() => api.me().then(setMe, () => undefined), []);
  useEffect(() => void loadMe(), [loadMe]);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);

  if (!me) return <p className="p-10 text-white/50">Carregando...</p>;

  // Phones that scanned a QR code never need an account.
  if (route.page === "guest") return <Guest token={route.token} />;
  if (!me.user) return <Login me={me} onSignedIn={loadMe} />;

  if (route.page === "sing") {
    return (
      <Player
        key={`${route.songId}:${route.item}`}
        eventId={route.eventId}
        songId={route.songId}
        queueItemId={route.item}
      />
    );
  }
  if (route.page === "event") return <EventPages eventId={route.eventId} tab={route.tab} me={me} />;
  return <Home me={me} onSignedOut={loadMe} />;
}
