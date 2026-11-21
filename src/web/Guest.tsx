import { useEffect, useState, type FormEvent } from "react";
import type { DuoSession, SongSummary } from "../shared/types";
import { api } from "./api";
import { useEvent, type LiveEvent } from "./useEvent";

const SESSION_KEY = "singwithme.duo";

function loadSession(): DuoSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as DuoSession | null;
    return session?.eventId && session.duo && session.secret ? session : null;
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-5 pb-16">
      <p className="py-6 text-2xl font-black tracking-tight">
        Sing<span className="text-accent">With</span>Me
      </p>
      {children}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <h1 className="mb-2 text-xl font-bold">{title}</h1>
      <p className="text-sm text-white/60">{children}</p>
    </div>
  );
}

type InviteInfo = { valid: boolean; eventName: string | null };

/** Registration form a phone sees after scanning a QR code that is still valid. */
function Join({
  token,
  eventName,
  onJoined,
}: {
  token: string;
  eventName: string | null;
  onJoined: (session: DuoSession) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      onJoined(await api.join(token, [String(data.get("first")), String(data.get("second"))]));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <div>
        <p className="text-xs text-accent uppercase">{eventName}</p>
        <h1 className="text-xl font-bold">Cadastre sua dupla</h1>
        <p className="text-sm text-white/60">Quem vai cantar junto?</p>
      </div>
      <input
        className="field"
        name="first"
        placeholder="Seu nome"
        aria-label="Seu nome"
        maxLength={24}
        required
        autoFocus
      />
      <input
        className="field"
        name="second"
        placeholder="Nome da sua dupla"
        aria-label="Nome da sua dupla"
        maxLength={24}
        required
      />
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button className="btn btn-primary w-full">Entrar no karaokê</button>
    </form>
  );
}

/** A registered duo's phone: pick songs and follow the queue. */
function Lobby({ session, live }: { session: DuoSession; live: LiveEvent }) {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const state = live.state!;

  useEffect(() => {
    const timer = setTimeout(() => api.songs(session.eventId, search).then(setSongs, () => undefined), 150);
    return () => clearTimeout(timer);
  }, [session.eventId, search]);

  const act = async (action: Promise<unknown>) => {
    setError(null);
    await action.catch((cause: Error) => setError(cause.message));
    await live.refresh();
  };

  const queued = new Set(state.queue.filter((item) => item.duoId === session.duo.id).map((item) => item.songId));

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <p className="text-xs text-white/50">{state.event.name} · sua dupla</p>
        <h1 className="text-2xl font-black">{session.duo.name}</h1>
      </div>

      {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

      <section className="card p-5">
        <h2 className="mb-2 font-bold">Fila</h2>
        {state.queue.length === 0 && <p className="text-sm text-white/50">Ninguém na fila. Escolha uma música!</p>}
        <ol className="space-y-2 text-sm">
          {state.queue.map((item, index) => {
            const own = item.duoId === session.duo.id;
            return (
              <li
                key={item.id}
                className={`flex items-center gap-3 rounded-xl border p-2 ${own ? "border-glow bg-glow/10" : "border-edge"}`}
              >
                <span className="w-5 text-center font-bold text-white/40">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {item.duoName} {item.singing && <span className="text-accent">· no palco</span>}
                  </p>
                  <p className="truncate text-white/60">{item.songTitle}</p>
                </div>
                {own && !item.singing && (
                  <button className="btn px-2 py-1 text-xs" onClick={() => act(api.dequeue(item.id, session.secret))}>
                    Sair
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card p-5">
        <h2 className="mb-2 font-bold">Escolher música</h2>
        <input
          className="field mb-3"
          placeholder="Buscar por música ou artista"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <ul className="divide-y divide-edge">
          {songs.map((song) => (
            <li key={song.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{song.title}</p>
                <p className="truncate text-sm text-white/60">{song.artist}</p>
              </div>
              <button
                className="btn btn-primary shrink-0 text-xs"
                disabled={queued.has(song.id)}
                onClick={() => act(api.enqueue(session.eventId, song.id, session.duo.id, session.secret))}
              >
                {queued.has(song.id) ? "Na fila" : "Entrar na fila"}
              </button>
            </li>
          ))}
        </ul>
        {songs.length === 0 && <p className="text-sm text-white/50">Nenhuma música encontrada.</p>}
      </section>
    </div>
  );
}

/** Everything a phone sees. `token` is present when it arrived from a QR code. */
export function Guest({ token }: { token: string | null }) {
  const [session, setSession] = useState(loadSession);
  const live = useEvent(session?.eventId ?? null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  useEffect(() => {
    setInvite(null);
    if (token) api.inviteInfo(token).then(setInvite, () => setInvite({ valid: false, eventName: null }));
  }, [token]);

  const joined = (created: DuoSession) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(created));
    setSession(created);
    location.hash = "#/me";
  };

  // A session only counts while its event is open and still lists the duo.
  const loading =
    (session !== null && live.state === null && live.error === null) || (token !== null && invite === null);
  const active =
    session && live.state?.event.status === "open" && live.state.duos.some((duo) => duo.id === session.duo.id);

  return (
    <Shell>
      {loading ? (
        <p className="text-white/50">Carregando...</p>
      ) : token && invite?.valid ? (
        // A fresh code always registers a new duo, even on a phone that sang at another event.
        <Join token={token} eventName={invite.eventName} onJoined={joined} />
      ) : active ? (
        <Lobby session={session} live={live} />
      ) : token ? (
        <Notice title="Este QR code já foi usado">
          Cada código cadastra uma dupla só. Escaneie o novo código que está na tela do karaokê.
        </Notice>
      ) : session && live.state?.event.status === "closed" ? (
        <Notice title="O evento terminou">
          Obrigado por cantar! Para o próximo, escaneie o QR code do novo evento.
        </Notice>
      ) : (
        <Notice title="Escaneie o QR code">
          Para cadastrar sua dupla e escolher músicas, aponte a câmera para o código na tela do karaokê.
        </Notice>
      )}
    </Shell>
  );
}
