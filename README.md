# SingWithMe

Karaokê com pontuação por afinação, fila de duplas e histórico por evento. Roda na sua máquina (offline) ou
hospedado. O áudio do microfone nunca sai do navegador. No modo local tudo fica em `./data` e a internet só é
usada na hora de importar uma música (YouTube e busca de letra).

## Como rodar

```bash
bun install
bun run doctor   # mostra quais ferramentas externas estão instaladas
bun start        # http://localhost:3210
```

Abra por `localhost`: o navegador só libera o microfone em contexto seguro. Use fones de ouvido para o
microfone captar só a sua voz.

| Ferramenta | Para quê | Obrigatória |
| --- | --- | --- |
| `ffmpeg` / `ffprobe` | ler a mídia e estimar a melodia | sim |
| `yt-dlp` | importar do YouTube | só para YouTube |
| `whisper-ctranslate2` ou `whisper` | transcrever a letra offline (~100 idiomas) | não |
| `demucs` | separar a voz: playback instrumental e melodia mais precisa | não |

Variáveis: `PORT`, `HOST`, `PUBLIC_URL`, `SINGWITHME_HOST_PIN`, `SINGWITHME_DEMO`, `SINGWITHME_DATA` (pasta de dados), `SINGWITHME_WHISPER_MODEL` (padrão `small`;
`medium`/`large-v3` erram menos em idiomas não europeus), `SINGWITHME_LRCLIB_URL` (instância própria do LRCLIB).

## Grupos, eventos e histórico

- Um **grupo** é quem usa o karaokê: um bar, uma família, uma empresa. Tem seus membros, seu acervo e seus eventos.
- Um **evento** é uma noite de karaokê. As duplas, a fila e tudo o que foi cantado pertencem a ele.
- Cada música cantada vira uma **apresentação**: o histórico do evento, o histórico do grupo e os rankings
  (por música e geral do grupo) saem daí. Encerrar um evento esvazia a fila e guarda o histórico.

Na aba **Fila e duplas** de um evento aberto aparece um QR code. Cada dupla aponta a câmera do celular, informa
os dois nomes e passa a escolher músicas e acompanhar a fila pelo telefone, sem criar conta.

- **Cada QR code vale um cadastro**: assim que uma dupla se registra, o código é trocado por outro.
- As duplas também podem ser criadas direto no painel, que reordena a fila e chama a próxima dupla.
- Ao cantar a partir da fila, a apresentação é salva no nome da dupla e ela sai da fila.
- Só membros do grupo importam ou apagam músicas, gravam apresentações e controlam a fila; pelo celular a
  dupla só mexe na própria vez.

## Dois jeitos de rodar

| | Local (offline) | Hospedado |
| --- | --- | --- |
| Banco | arquivo SQLite em `./data` | Postgres, via `DATABASE_URL` |
| Quem é anfitrião | quem está no computador (`localhost`) ou sabe o `SINGWITHME_HOST_PIN` | quem entra com código enviado por e-mail |
| Acervo | importado pelo YouTube ou por arquivo | músicas de demonstração (`SINGWITHME_DEMO=1`, sempre ligado na Vercel) |

O código é o mesmo: o cliente SQL do Bun fala com os dois bancos e as consultas usam só o que ambos entendem.

**Local**: os celulares precisam estar no mesmo Wi-Fi (`HOST=127.0.0.1` desliga o acesso pela rede). Se o
endereço do QR code sair errado (várias placas de rede, túnel), defina `PUBLIC_URL=http://endereço:porta`.

**Hospedado** (`vercel.json`, runtime Bun, entrada em `server.ts`). O login é por código enviado ao e-mail,
sem senha: contas, códigos, sessões e cookies são do [Better Auth](https://better-auth.com) (plugin
`emailOTP`), montado em `/api/auth`; `src/server/auth.ts` só o configura. O código tem 6 dígitos, vale
10 minutos e aceita 5 tentativas; cada endereço pede no máximo 3 códigos por minuto.

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Postgres (dados do app e tabelas do Better Auth, criadas na primeira requisição) |
| `BETTER_AUTH_SECRET` | chave que assina as sessões; gere com `openssl rand -hex 32` |
| `RESEND_API_KEY` | envia os códigos pelo [Resend](https://resend.com); sem ela, a instância hospedada não tem login |
| `SINGWITHME_EMAIL_FROM` | remetente, ex. `SingWithMe <login@seudominio.com>`; o padrão de teste do Resend só entrega para o dono da conta Resend |
| `SINGWITHME_ALLOWED_EMAILS` | quem pode ter conta, separado por vírgula; vazia libera qualquer e-mail |
| `BETTER_AUTH_URL` | endereço público, se não for o domínio de produção da Vercel |

Rodando localmente com banco e sem `RESEND_API_KEY`, o código aparece no terminal do servidor.

**Segredos nunca entram no repositório.** Cadastre-os nas variáveis de ambiente da Vercel (Project Settings →
Environment Variables) ou nos secrets do GitHub; `.env` e `.env.*` estão no `.gitignore`.

Na Vercel não há ffmpeg nem disco durável, então não se importa música por lá: o acervo são três músicas
tradicionais sintetizadas (`bun scripts/make-demo.ts`).

## Adicionando músicas

- **Link do YouTube**: baixa o vídeo (ou só o áudio) e procura a letra.
- **Arquivo local**: qualquer áudio/vídeo que o ffmpeg leia.
- Em ambos dá para anexar a letra: um `.lrc` (inclusive com tempo por palavra) ou um mapa **UltraStar `.txt`**.

Sem letra anexada, a ordem de busca é:

1. **LRCLIB**, se a duração da gravação bater (±3 s);
2. legenda escrita por humanos no próprio vídeo;
3. transcrição local com **Whisper**, com tempo por palavra;
4. letra do LRCLIB de outra gravação, marcada para você ajustar o atraso no player (botões "Letra −/+").

## Pontuação

De 0 a 100 por música, comparando a nota cantada (detector YIN no navegador) com o alvo a cada 40 ms.
Oitavas são perdoadas. A tolerância depende da dificuldade: 2, 1 ou 0,5 semitom.

| Modo | Quando | Alvo |
| --- | --- | --- |
| Notas exatas | mapa UltraStar | as notas do mapa; notas douradas valem o dobro |
| Melodia estimada | demais músicas | contorno de afinação extraído da gravação original |
| Só ritmo | não foi possível estimar a melodia | cantar enquanto a letra está na tela |

A melodia estimada é uma aproximação: numa mixagem completa o detector às vezes segue um instrumento em vez
da voz. Separar a voz com o demucs na importação melhora bastante; um mapa UltraStar é o mais preciso.

## Acervos de letras e mapas

| Acervo | Cobertura | O que oferece | Uso aqui |
| --- | --- | --- | --- |
| [LRCLIB](https://lrclib.net) | global, todos os idiomas, ~3 milhões de letras | letra sincronizada por linha, API aberta sem chave, dump SQLite para espelho offline | integrado |
| [USDB](https://usdb.animux.de) | global, forte em inglês/alemão/espanhol, tem música brasileira | mapas UltraStar com nota por sílaba (exige cadastro) | baixe o `.txt` e anexe |
| [UltraStar España](https://ultrastar-es.org) | espanhol e latino | mapas UltraStar | baixe o `.txt` e anexe |
| [Karaoke Mugen](https://kara.moe) | japonês, anime, k-pop | base aberta em git, legendas `.ass` com tempo por sílaba | não lido ainda (formato `.ass`) |
| [Vagalume](https://api.vagalume.com.br) | maior acervo brasileiro | letra e tradução **sem** sincronia, API com chave | não integrado: sem tempo não serve ao karaokê |
| Whisper | ~100 idiomas | transcrição local do próprio áudio | integrado, cobre o que nenhum acervo tem |

Letras.mus.br, Genius e Musixmatch não têm API aberta com letra sincronizada. NetEase e QQ Music têm muita
letra sincronizada em chinês, japonês e coreano, mas só por APIs não oficiais.

Importe apenas músicas que você tem direito de usar; baixar do YouTube pode violar os termos do serviço.

## Desenvolvimento

```bash
bun dev          # servidor com hot reload
bun test                                   # SQLite
DATABASE_URL=postgres://... bun test       # as mesmas consultas no Postgres
bun run typecheck
```

- `src/shared`: parsers (LRC, VTT, UltraStar), detector de afinação e pontuação, usados no servidor e no navegador.
- `src/server`: API HTTP (Bun), banco (`db.ts`, `store.ts`), login (`auth.ts`) e o pipeline de importação.
- `src/web`: interface em React + Tailwind.
