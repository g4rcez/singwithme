import { useEffect, useState, type FormEvent } from "react";
import type { Job, ToolStatus } from "../shared/types";
import { api } from "./api";

type Tab = "youtube" | "file";

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("youtube");
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.tools().then(setTools, () => undefined);
  }, []);

  // Poll the running import until it finishes.
  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = setTimeout(() => {
      api.job(job.id).then(setJob, (cause: Error) => setError(cause.message));
    }, 800);
    return () => clearTimeout(timer);
  }, [job]);

  const has = (name: string) => tools.find((tool) => tool.name === name)?.found ?? false;
  const missing = tools.filter((tool) => !tool.found);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    // One lyrics input for both formats: an UltraStar chart is recognised by its #BPM header.
    const lyrics = form.get("lyrics");
    form.delete("lyrics");
    if (lyrics instanceof File && lyrics.size > 0) {
      const isChart = /^#BPM:/im.test(await lyrics.text());
      form.set(isChart ? "ultrastar" : "lrc", lyrics);
    }
    setSending(true);
    try {
      setJob(await (tab === "youtube" ? api.importYoutube(form) : api.importFile(form)));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal>
      <div className="card w-full max-w-xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Adicionar música</h2>
          <button className="cursor-pointer text-white/50 hover:text-white" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        {job ? (
          <JobProgress job={job} onClose={onClose} onRetry={() => setJob(null)} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex gap-2">
              {(["youtube", "file"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`btn flex-1 ${tab === option ? "border-glow" : ""}`}
                  onClick={() => setTab(option)}
                >
                  {option === "youtube" ? "Link do YouTube" : "Arquivo local"}
                </button>
              ))}
            </div>

            {tab === "youtube" ? (
              <label className="block text-sm">
                Link do vídeo
                <input className="field mt-1" name="url" type="url" required placeholder="https://www.youtube.com/watch?v=..." />
              </label>
            ) : (
              <label className="block text-sm">
                Áudio ou vídeo
                <input className="field mt-1" name="media" type="file" required accept="audio/*,video/*" />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                Título <span className="text-white/40">(opcional)</span>
                <input className="field mt-1" name="title" />
              </label>
              <label className="block text-sm">
                Artista <span className="text-white/40">(opcional)</span>
                <input className="field mt-1" name="artist" />
              </label>
            </div>
            <p className="-mt-2 text-xs text-white/40">
              Título e artista corretos ajudam a achar a letra sincronizada. Em branco, são deduzidos do vídeo.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                Letra <span className="text-white/40">(.lrc ou UltraStar .txt, opcional)</span>
                <input className="field mt-1" name="lyrics" type="file" accept=".lrc,.txt,text/plain" />
              </label>
              <label className="block text-sm">
                Idioma <span className="text-white/40">(ex.: pt, en, ja)</span>
                <input className="field mt-1" name="language" maxLength={5} placeholder="automático" />
              </label>
            </div>

            <div className="space-y-2 text-sm">
              {tab === "youtube" && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="audioOnly" value="true" /> Baixar só o áudio (sem vídeo de fundo)
                </label>
              )}
              <label className={`flex items-center gap-2 ${has("demucs") ? "" : "text-white/40"}`}>
                <input type="checkbox" name="separate" value="true" disabled={!has("demucs")} />
                Separar a voz para ter playback instrumental {has("demucs") ? "(lento)" : "(requer demucs)"}
              </label>
            </div>

            {missing.length > 0 && (
              <details className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100/80">
                <summary className="cursor-pointer">
                  Ferramentas não instaladas: {missing.map((tool) => tool.name).join(", ")}
                </summary>
                <ul className="mt-2 space-y-1">
                  {missing.map((tool) => (
                    <li key={tool.name}>
                      <strong>{tool.name}</strong>: {tool.purpose}. <code>{tool.install}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

            <button className="btn btn-primary w-full" disabled={sending || (tab === "youtube" && !has("yt-dlp"))}>
              {sending ? "Enviando..." : "Importar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function JobProgress({ job, onClose, onRetry }: { job: Job; onClose: () => void; onRetry: () => void }) {
  return (
    <div className="space-y-4">
      <p className="font-semibold">{job.status === "error" ? "A importação falhou" : job.step}</p>
      {job.status === "running" && (
        <div className="h-2 overflow-hidden rounded-full bg-edge">
          <div
            className={`h-full bg-linear-to-r from-accent to-glow ${job.progress === null ? "w-1/3 animate-pulse" : ""}`}
            style={job.progress === null ? undefined : { width: `${Math.round(job.progress * 100)}%` }}
          />
        </div>
      )}
      {job.error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{job.error}</p>}
      <pre className="max-h-40 overflow-y-auto rounded-xl bg-ink/70 p-3 text-xs whitespace-pre-wrap text-white/50">
        {job.log.slice(-12).join("\n")}
      </pre>
      <div className="flex justify-end gap-2">
        {job.status === "error" && (
          <button className="btn" onClick={onRetry}>
            Tentar de novo
          </button>
        )}
        {job.status === "done" && job.songId && (
          <a className="btn btn-primary" href={`#/sing/${encodeURIComponent(job.songId)}`}>
            Cantar agora
          </a>
        )}
        <button className="btn" onClick={onClose}>
          {job.status === "running" ? "Continuar em segundo plano" : "Fechar"}
        </button>
      </div>
    </div>
  );
}
