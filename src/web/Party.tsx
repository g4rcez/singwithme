import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import type { EventState, Invite, SongSummary } from "../shared/types";
import { api } from "./api";

/** The QR code on screen. It is replaced as soon as a phone registers with it. */
function InviteCode({ eventId }: { eventId: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.invite(eventId).then(setInvite, () => undefined);
    void load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [eventId]);

  useEffect(() => {
    if (!invite) return;
    let stale = false;
    void QRCode.toDataURL(invite.url, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then((url) => {
      if (!stale) setImage(url);
    });
    return () => {
      stale = true;
    };
  }, [invite?.token]);

  return (
    <section className="card p-6 text-center">
      <h2 className="text-lg font-bold">Cadastre sua dupla pelo celular</h2>
      <p className="mb-4 text-sm text-white/50">
        Aponte a câmera. Cada código vale para uma dupla: depois do cadastro, aparece um novo.
      </p>
      <div className="mx-auto grid aspect-square w-56 place-items-center rounded-2xl bg-white p-2">
        {image && <img src={image} alt="QR code de cadastro" className="h-full w-full" data-testid="invite-qr" />}
      </div>
      <p className="mt-3 text-xs break-all text-white/40" data-testid="invite-url">
        {invite?.url}
      </p>
    </section>
  );
}

function DuoForm({ eventId, onCreated }: { eventId: string; onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api.createDuo(eventId, [String(data.get("first")), String(data.get("second"))]);
      form.reset();
      setError(null);
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input className="field" name="first" placeholder="Nome" aria-label="Primeiro nome" maxLength={24} required />
        <input className="field" name="second" placeholder="Nome" aria-label="Segundo nome" maxLength={24} required />
        <button className="btn shrink-0">Criar dupla</button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </form>
  );
}

export function Party({ state: party, refresh }: { state: EventState; refresh: () => Promise<void> }) {
  const eventId = party.event.id;
  const open = party.event.status === "open";
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.songs(eventId).then(setSongs, () => undefined);
  }, [eventId]);

  const act = async (action: Promise<unknown>) => {
    setError(null);
    await action.catch((cause: Error) => setError(cause.message));
    await refresh();
  };

  const addToQueue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act(api.enqueue(eventId, String(data.get("song")), String(data.get("duo"))));
  };

  const sing = async (itemId: string, songId: string) => {
    await act(api.startItem(itemId));
    location.hash = `#/e/${eventId}/sing/${encodeURIComponent(songId)}?item=${itemId}`;
  };

  if (!open) {
    return (
      <main className="card p-10 text-center text-white/60">
        <p className="mb-1 text-lg font-semibold text-white">Evento encerrado</p>
        <p>A fila foi fechada. O que foi cantado está na aba Histórico; reabra o evento para continuar.</p>
      </main>
    );
  }

  return (
    <main className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-6">
        <InviteCode eventId={eventId} />
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">Duplas ({party.duos.length})</h2>
          <DuoForm eventId={eventId} onCreated={refresh} />
          <ul className="divide-y divide-edge text-sm">
            {party.duos.map((duo) => (
              <li key={duo.id} className="flex items-center justify-between py-2">
                <span className="font-semibold">{duo.name}</span>
                <button
                  className="cursor-pointer text-white/30 hover:text-red-400"
                  aria-label={`Remover ${duo.name}`}
                  title="Remover a dupla (e as músicas dela na fila)"
                  onClick={() => act(api.removeDuo(duo.id))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-6">
        <h2 className="mb-4 text-lg font-bold">Fila ({party.queue.length})</h2>

        <form onSubmit={addToQueue} className="mb-4 flex flex-wrap gap-2">
          <select className="field min-w-40 flex-1" name="duo" required aria-label="Dupla" defaultValue="">
            <option value="" disabled>
              Dupla
            </option>
            {party.duos.map((duo) => (
              <option key={duo.id} value={duo.id}>
                {duo.name}
              </option>
            ))}
          </select>
          <select className="field min-w-40 flex-1" name="song" required aria-label="Música" defaultValue="">
            <option value="" disabled>
              Música
            </option>
            {songs.map((song) => (
              <option key={song.id} value={song.id}>
                {song.title} · {song.artist}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!party.duos.length || !songs.length}>
            Pôr na fila
          </button>
        </form>

        {error && <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

        {party.queue.length === 0 ? (
          <p className="py-10 text-center text-sm text-white/50">
            A fila está vazia. As duplas escolhem a música pelo celular, ou você adiciona aqui.
          </p>
        ) : (
          <ol className="space-y-2" data-testid="queue">
            {party.queue.map((item, index) => (
              <li
                key={item.id}
                className={`flex items-center gap-3 rounded-xl border p-3 ${item.singing ? "border-accent bg-accent/10" : "border-edge"}`}
              >
                <span className="w-6 text-center font-bold text-white/40">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{item.duoName}</p>
                  <p className="truncate text-sm text-white/60">
                    {item.songTitle} · {item.songArtist}
                    {item.singing && <span className="ml-2 text-accent">no palco</span>}
                  </p>
                </div>
                <button
                  className="btn px-2 py-1"
                  aria-label="Subir na fila"
                  disabled={index === 0}
                  onClick={() => act(api.moveItem(item.id, "up"))}
                >
                  ↑
                </button>
                <button
                  className="btn px-2 py-1"
                  aria-label="Descer na fila"
                  disabled={index === party.queue.length - 1}
                  onClick={() => act(api.moveItem(item.id, "down"))}
                >
                  ↓
                </button>
                <button className="btn px-2 py-1" aria-label="Tirar da fila" onClick={() => act(api.dequeue(item.id))}>
                  ✕
                </button>
                <button
                  className={`btn ${index === 0 ? "btn-primary" : ""}`}
                  onClick={() => sing(item.id, item.songId)}
                >
                  Cantar
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
