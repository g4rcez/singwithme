import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Group, Me, Performance } from "../shared/types";
import { api } from "./api";
import { authClient } from "./authClient";
import { when } from "./format";
import { PerformanceTable } from "./Ranking";

type Panel = { groupId: string; kind: "history" | "ranking" };

/** Shown on demand, so a group with years of events does not load everything up front. */
function GroupPanel({ panel }: { panel: Panel }) {
  const [entries, setEntries] = useState<Performance[] | null>(null);
  useEffect(() => {
    setEntries(null);
    const load = panel.kind === "history" ? api.groupHistory : api.groupRanking;
    load(panel.groupId).then(setEntries, () => setEntries([]));
  }, [panel.groupId, panel.kind]);

  if (!entries) return <p className="py-4 text-sm text-white/50">Carregando...</p>;
  return (
    <div className="mt-4 border-t border-edge pt-4">
      <PerformanceTable entries={entries} ranked={panel.kind === "ranking"} showEvent showSong />
    </div>
  );
}

function InlineForm({
  label,
  placeholder,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await onSubmit(String(new FormData(form).get("name")));
      form.reset();
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <form onSubmit={submit}>
      <div className="flex gap-2">
        <input
          className="field"
          name="name"
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={60}
          required
        />
        <button className="btn shrink-0">{label}</button>
      </div>
      {error && <p className="mt-1 text-sm text-red-300">{error}</p>}
    </form>
  );
}

/** Groups and their events: the starting point for whoever runs the karaoke. */
export function Home({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.groups().then(setGroups, (cause: Error) => setError(cause.message)), []);
  useEffect(() => void load(), [load]);

  const togglePanel = (next: Panel) =>
    setPanel((current) => (current?.groupId === next.groupId && current.kind === next.kind ? null : next));

  const createEvent = async (groupId: string, name: string) => {
    const event = await api.createEvent(groupId, name);
    location.hash = `#/e/${event.id}/party`;
  };

  return (
    <div className="mx-auto max-w-4xl px-5 pb-16">
      <header className="flex items-center justify-between gap-3 py-6">
        <p className="text-2xl font-black tracking-tight">
          Sing<span className="text-accent">With</span>Me
        </p>
        {me.auth === "accounts" && me.user && (
          <div className="flex items-center gap-3 text-sm text-white/60">
            <span className="hidden sm:inline">{me.user.email}</span>
            <button className="btn" onClick={() => authClient.signOut().then(onSignedOut)}>
              Sair
            </button>
          </div>
        )}
      </header>

      {error && <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

      <main className="space-y-6">
        {groups?.length === 0 && (
          <div className="card p-6 text-center text-white/60">
            <p className="text-lg font-semibold text-white">Crie seu primeiro grupo</p>
            <p>Um grupo é o seu bar, sua família ou sua empresa. Cada grupo tem seus eventos e seu histórico.</p>
          </div>
        )}

        {groups?.map((group) => (
          <section key={group.id} className="card p-6" data-testid="group">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">{group.name}</h2>
              <div className="flex gap-2">
                {(["history", "ranking"] as const).map((kind) => (
                  <button
                    key={kind}
                    className={`btn text-xs ${panel?.groupId === group.id && panel.kind === kind ? "border-glow" : ""}`}
                    onClick={() => togglePanel({ groupId: group.id, kind })}
                  >
                    {kind === "history" ? "Histórico do grupo" : "Ranking do grupo"}
                  </button>
                ))}
              </div>
            </div>

            <InlineForm
              label="Novo evento"
              placeholder="Nome do evento (ex.: Sexta do karaokê)"
              onSubmit={(name) => createEvent(group.id, name)}
            />

            <ul className="mt-4 divide-y divide-edge">
              {group.events.map((event) => (
                <li key={event.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{event.name}</p>
                    <p className="text-xs text-white/50">
                      {when(event.createdAt)} · {event.performances}{" "}
                      {event.performances === 1 ? "música cantada" : "músicas cantadas"}
                    </p>
                  </div>
                  <span className={`chip ${event.status === "open" ? "border-hit/50 text-hit" : ""}`}>
                    {event.status === "open" ? "Aberto" : "Encerrado"}
                  </span>
                  <a
                    className={`btn ${event.status === "open" ? "btn-primary" : ""}`}
                    href={`#/e/${event.id}/${event.status === "open" ? "party" : "history"}`}
                  >
                    {event.status === "open" ? "Abrir" : "Ver histórico"}
                  </a>
                </li>
              ))}
            </ul>
            {group.events.length === 0 && (
              <p className="mt-4 text-sm text-white/50">Nenhum evento ainda. Crie o primeiro acima.</p>
            )}

            {panel?.groupId === group.id && <GroupPanel panel={panel} />}
          </section>
        ))}

        {groups && (
          <section className="card p-6">
            <h2 className="mb-3 font-bold">Novo grupo</h2>
            <InlineForm
              label="Criar grupo"
              placeholder="Nome do grupo"
              onSubmit={(name) => api.createGroup(name).then(load)}
            />
          </section>
        )}
      </main>
    </div>
  );
}
