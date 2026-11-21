import { useState, type FormEvent } from "react";
import type { Me } from "../shared/types";
import { api, hostPin } from "./api";
import { authClient } from "./authClient";

/** Where Better Auth sends the browser when a sign-in is refused (for example, an address off the allowlist). */
const REFUSED = "/?acesso=negado";

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

const PROVIDERS = [
  { id: "github", label: "Entrar com GitHub" },
  { id: "google", label: "Entrar com Google" },
] as const;

function PasswordForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    setBusy(true);
    const { error: failure } = creating
      ? await authClient.signUp.email({ email, password, name: email.split("@")[0] ?? email })
      : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (failure) return setError(failure.message ?? "Não foi possível entrar.");
    onSignedIn();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        className="field"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="voce@exemplo.com"
        aria-label="E-mail"
        required
      />
      <input
        className="field"
        name="password"
        type="password"
        autoComplete={creating ? "new-password" : "current-password"}
        placeholder="Senha"
        aria-label="Senha"
        minLength={8}
        required
      />
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>
        {creating ? "Criar conta" : "Entrar"}
      </button>
      <button
        type="button"
        className="w-full cursor-pointer text-sm text-white/50 hover:text-white"
        onClick={() => setCreating(!creating)}
      >
        {creating ? "Já tenho conta" : "Criar uma conta"}
      </button>
    </form>
  );
}

/** Hosted instances: every sign-in goes through Better Auth. */
function AccountLogin({ methods, onSignedIn }: { methods: Me["methods"]; onSignedIn: () => void }) {
  const refused = new URLSearchParams(location.search).has("acesso");
  const offered = PROVIDERS.filter((provider) => methods[provider.id]);

  return (
    <Frame>
      <h1 className="mb-4 text-xl font-bold">Entrar</h1>
      {refused && (
        <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
          Esta conta ainda não tem acesso ao SingWithMe.
        </p>
      )}
      <div className="space-y-3">
        {offered.map((provider) => (
          <button
            key={provider.id}
            className="btn btn-primary w-full"
            onClick={() =>
              authClient.signIn.social({ provider: provider.id, callbackURL: "/", errorCallbackURL: REFUSED })
            }
          >
            {provider.label}
          </button>
        ))}
        {methods.password && <PasswordForm onSignedIn={onSignedIn} />}
        {!offered.length && !methods.password && (
          <p className="text-sm text-white/60">Nenhuma forma de login foi configurada nesta instância.</p>
        )}
      </div>
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
    <AccountLogin methods={me.methods} onSignedIn={onSignedIn} />
  ) : (
    <LocalLogin pinRequired={me.pinRequired} onSignedIn={onSignedIn} />
  );
}
