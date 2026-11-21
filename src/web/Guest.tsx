import { useEffect, useState, type FormEvent } from "react";
import type { DuoSession, PartyState, SongSummary } from "../shared/types";
import { api, hostPin } from "./api";

const SESSION_KEY = "singwithme.duo";

function loadSession(): DuoSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as DuoSession | null;
  } catch {
    return null;
  }
}

/** Lets the person running the karaoke identify themselves on instances protected by a PIN. */
function HostLogin({ refresh }: { refresh: () => Promise<void> }) {
  const [error, setError] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    hostPin.set(String(new FormData(event.currentTarget).get("pin")));
    const party = await api.party().catch(() => null);
    if (party?.isHost) return refresh();
    hostPin.clear();
    setError(true);
  };
  return (
    <details className="mt-8 text-sm text-white/50">
      <summary className="cursor-pointer">Sou o anfitrião</summary>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          className="field"
          name="pin"
          type="password"
          placeholder="PIN do anfitrião"
          aria-label="PIN do anfitrião"
          required
        />
        <button className="btn shrink-0">Entrar</button>
      </form>
      {error && <p className="mt-2 text-red-300">PIN incorreto.</p>}
    </details>
  );
}

function Shell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-5 pb-16">
      <p className="py-6 text-2xl font-black tracking-tight">
        Sing<span className="text-accent">With</span>Me
      </p>
      {children}
      {footer}
    </div>
  );
}

/** Registration form a phone sees after scanning a QR code. */
function Join({ token, onJoined }: { token: string; onJoined: (session: DuoSession) => void }) {
  const [valid, setValid] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.inviteValid(token).then(
      (response) => setValid(response.valid),
      () => setValid(false),
    );
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      onJoined(await api.join(token, [String(data.get("first")), String(data.get("second"))]));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  if (valid === null) return <p className="text-white/50">Conferindo o código...</p>;
  if (!valid) {
    return (
      <div className="card p-6">
        <h1 className="mb-2 text-xl font-bold">Este QR code já foi usado</h1>
        <p className="text-sm text-white/60">
          Cada código cadastra uma dupla só. Escaneie o novo código que está na tela do karaokê.
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <div>
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
function Lobby({ session, party, refresh }: { session: DuoSession; party: PartyState; refresh: () => Promise<void> }) {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => api.songs(search).then(setSongs, () => undefined), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const act = async (action: Promise<unknown>) => {
    setError(null);
    await action.catch((cause: Error) => setError(cause.message));
    await refresh();
  };

  const mine = party.queue.filter((item) => item.duoId === session.duo.id);
  const queued = new Set(mine.map((item) => item.songId));

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <p className="text-xs text-white/50">Sua dupla</p>
        <h1 className="text-2xl font-black">{session.duo.name}</h1>
      </div>

      {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

      <section className="card p-5">
        <h2 className="mb-2 font-bold">Fila</h2>
        {party.queue.length === 0 && <p className="text-sm text-white/50">Ninguém na fila. Escolha uma música!</p>}
        <ol className="space-y-2 text-sm">
          {party.queue.map((item, index) => {
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
                onClick={() => act(api.enqueue(song.id, session.duo.id, session.secret))}
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

interface Props {
  party: PartyState;
  refresh: () => Promise<void>;
  /** Present when the phone arrived from a QR code. */
  token: string | null;
}

export function Guest({ party, refresh, token }: Props) {
  const [session, setSession] = useState(loadSession);

  // The party lives in the server's memory: after a restart the saved duo no longer exists.
  const active = session && party.duos.some((duo) => duo.id === session.duo.id) ? session : null;

  const joined = (created: DuoSession) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(created));
    setSession(created);
    location.hash = "#/me";
    void refresh();
  };

  return (
    <Shell footer={party.pinRequired && !active ? <HostLogin refresh={refresh} /> : null}>
      {active ? (
        <Lobby session={active} party={party} refresh={refresh} />
      ) : token ? (
        <Join token={token} onJoined={joined} />
      ) : (
        <div className="card p-6">
          <h1 className="mb-2 text-xl font-bold">Escaneie o QR code</h1>
          <p className="text-sm text-white/60">
            Para cadastrar sua dupla e escolher músicas, aponte a câmera para o código na tela do karaokê.
          </p>
        </div>
      )}
    </Shell>
  );
}
