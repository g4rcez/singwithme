import { useState, type FormEvent } from "react";
import type { Me } from "../shared/types";
import { api, hostPin } from "./api";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid min-h-screen max-w-md content-center px-5 py-10">
      <p className="mb-6 text-center text-3xl font-black tracking-tight">
        Sing<span className="text-accent">With</span>Me
      </p>
      <div className="card p-6">{children}</div>
      <p className="mt-6 text-center text-sm text-white/40">
        Veio cantar? Aponte a câmera do celular para o QR code na tela do karaokê.
      </p>
    </div>
  );
}

/** Sign-in with a one-time code sent by e-mail. */
function EmailLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, done: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      done();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const requestCode = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => api.requestCode(email),
      () => setSentTo(email.trim()),
    );
  };

  const verify = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code"));
    void run(() => api.verifyCode(sentTo ?? email, code), onSignedIn);
  };

  return (
    <Frame>
      <h1 className="mb-1 text-xl font-bold">Entrar</h1>
      {sentTo ? (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm text-white/60">
            Enviamos um código para <strong className="text-white">{sentTo}</strong>. Digite-o abaixo.
          </p>
          <input
            className="field text-center text-2xl tracking-[0.4em]"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{4,8}"
            maxLength={8}
            placeholder="000000"
            aria-label="Código"
            required
            autoFocus
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Conferindo..." : "Entrar"}
          </button>
          <button
            type="button"
            className="w-full cursor-pointer text-sm text-white/50 hover:text-white"
            onClick={() => setSentTo(null)}
          >
            Usar outro e-mail ou pedir novo código
          </button>
        </form>
      ) : (
        <form onSubmit={requestCode} className="space-y-4">
          <p className="text-sm text-white/60">Você recebe um código por e-mail, sem senha.</p>
          <input
            className="field"
            type="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            aria-label="E-mail"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Enviando..." : "Receber código"}
          </button>
        </form>
      )}
    </Frame>
  );
}

/** Offline installs: the host is whoever sits at the karaoke machine, or knows its PIN. */
function LocalLogin({ pinRequired, onSignedIn }: { pinRequired: boolean; onSignedIn: () => void }) {
  const [error, setError] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    hostPin.set(String(new FormData(event.currentTarget).get("pin")));
    const me = await api.me().catch(() => null);
    if (me?.user) return onSignedIn();
    hostPin.clear();
    setError(true);
  };
  return (
    <Frame>
      <h1 className="mb-1 text-xl font-bold">Painel do anfitrião</h1>
      {pinRequired ? (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-white/60">Digite o PIN configurado neste karaokê.</p>
          <input
            className="field"
            name="pin"
            type="password"
            placeholder="PIN do anfitrião"
            aria-label="PIN do anfitrião"
            required
          />
          {error && <p className="text-sm text-red-300">PIN incorreto.</p>}
          <button className="btn btn-primary w-full">Entrar</button>
        </form>
      ) : (
        <p className="text-sm text-white/60">
          O painel só abre no próprio computador do karaokê, pelo endereço <code>localhost</code>.
        </p>
      )}
    </Frame>
  );
}

export function Login({ me, onSignedIn }: { me: Me; onSignedIn: () => void }) {
  return me.auth === "email" ? (
    <EmailLogin onSignedIn={onSignedIn} />
  ) : (
    <LocalLogin pinRequired={me.pinRequired} onSignedIn={onSignedIn} />
  );
}
