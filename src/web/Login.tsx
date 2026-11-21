import { useState, type FormEvent } from "react";
import type { Me } from "../shared/types";
import { api, hostPin } from "./api";
import { authClient } from "./authClient";

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

/** Hosted instances: a one-time code sent by e-mail, handled end to end by Better Auth. */
function EmailLogin({ available, onSignedIn }: { available: boolean; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const address = email.trim().toLowerCase();
    const { error: failure } = await authClient.emailOtp.sendVerificationOtp({ email: address, type: "sign-in" });
    setBusy(false);
    if (failure) return setError(failure.message ?? "Não foi possível enviar o código agora.");
    setSentTo(address);
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const otp = String(new FormData(event.currentTarget).get("code")).trim();
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.signIn.emailOtp({ email: sentTo ?? "", otp });
    setBusy(false);
    if (failure) {
      return setError(
        failure.code === "TOO_MANY_ATTEMPTS"
          ? "Muitas tentativas. Peça um novo código."
          : "Código incorreto ou expirado. Confira o e-mail ou peça um novo código.",
      );
    }
    onSignedIn();
  };

  if (!available) {
    return (
      <Frame>
        <h1 className="mb-1 text-xl font-bold">Entrar</h1>
        <p className="text-sm text-white/60">O envio de e-mails ainda não foi configurado nesta instância.</p>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="mb-1 text-xl font-bold">Entrar</h1>
      {sentTo ? (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm text-white/60">
            Enviamos um código para <strong className="text-white">{sentTo}</strong>. Ele vale por 10 minutos.
          </p>
          <input
            className="field text-center text-2xl tracking-[0.4em]"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
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
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
          >
            Usar outro e-mail ou pedir novo código
          </button>
        </form>
      ) : (
        <form onSubmit={requestCode} className="space-y-4">
          <p className="text-sm text-white/60">Você recebe um código por e-mail. Não precisa de senha.</p>
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
  return me.auth === "accounts" ? (
    <EmailLogin available={me.emailSignIn} onSignedIn={onSignedIn} />
  ) : (
    <LocalLogin pinRequired={me.pinRequired} onSignedIn={onSignedIn} />
  );
}
