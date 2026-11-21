import { useEffect, useState } from "react";
import { Guest } from "./Guest";
import { Library } from "./Library";
import { Party } from "./Party";
import { Player } from "./Player";
import { Ranking } from "./Ranking";
import { useParty } from "./useParty";

type Route =
  | { page: "library" | "ranking" | "party" | "me" }
  | { page: "join"; token: string }
  | { page: "sing"; id: string; item: string | null };

function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.split("?");
  const [, page, id] = path.split("/");
  if (page === "sing" && id) {
    return { page: "sing", id: decodeURIComponent(id), item: new URLSearchParams(query).get("item") };
  }
  if (page === "join" && id) return { page: "join", token: id };
  if (page === "ranking" || page === "party" || page === "me") return { page };
  return { page: "library" };
}

const TABS = [
  { page: "library", href: "#/", label: "Músicas" },
  { page: "party", href: "#/party", label: "Fila e duplas" },
  { page: "ranking", href: "#/ranking", label: "Ranking" },
] as const;

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const { party, refresh } = useParty();

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);

  if (!party) return <p className="p-10 text-white/50">Carregando...</p>;

  // Phones only ever see the registration and queue screens.
  if (!party.isHost) {
    return <Guest party={party} refresh={refresh} token={route.page === "join" ? route.token : null} />;
  }

  if (route.page === "sing") {
    return <Player key={`${route.id}:${route.item}`} songId={route.id} queueItemId={route.item} />;
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <a href="#/" className="text-2xl font-black tracking-tight">
          Sing<span className="text-accent">With</span>Me
        </a>
        <nav className="flex gap-2 text-sm">
          {TABS.map((tab) => (
            <a key={tab.page} href={tab.href} className={`btn ${route.page === tab.page ? "border-glow" : ""}`}>
              {tab.label}
              {tab.page === "party" && party.queue.length > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-xs">{party.queue.length}</span>
              )}
            </a>
          ))}
        </nav>
      </header>
      {route.page === "ranking" ? (
        <Ranking />
      ) : route.page === "party" ? (
        <Party party={party} refresh={refresh} />
      ) : (
        <Library demo={party.demo} />
      )}
    </div>
  );
}
