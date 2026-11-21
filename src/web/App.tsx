import { useEffect, useState } from "react";
import { Library } from "./Library";
import { Player } from "./Player";
import { Ranking } from "./Ranking";

type Route = { page: "library" } | { page: "ranking" } | { page: "sing"; id: string };

function parseRoute(hash: string): Route {
  const [, page, id] = hash.split("/");
  if (page === "sing" && id) return { page: "sing", id: decodeURIComponent(id) };
  if (page === "ranking") return { page: "ranking" };
  return { page: "library" };
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);

  if (route.page === "sing") return <Player key={route.id} songId={route.id} />;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <header className="flex items-center justify-between py-6">
        <a href="#/" className="text-2xl font-black tracking-tight">
          Sing<span className="text-accent">With</span>Me
        </a>
        <nav className="flex gap-2 text-sm">
          <a href="#/" className={`btn ${route.page === "library" ? "border-glow" : ""}`}>
            Músicas
          </a>
          <a href="#/ranking" className={`btn ${route.page === "ranking" ? "border-glow" : ""}`}>
            Ranking
          </a>
        </nav>
      </header>
      {route.page === "ranking" ? <Ranking /> : <Library />}
    </div>
  );
}
