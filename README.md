# SingWithMe

Karaokê offline com pontuação por afinação e ranking por música. Roda na sua máquina: as músicas, as letras e
os placares ficam em `./data` e nada do microfone sai do navegador. A internet só é usada na hora de importar
uma música (YouTube e busca de letra).

## Como rodar

```bash
bun install
bun run doctor   # mostra quais ferramentas externas estão instaladas
bun start        # http://127.0.0.1:3210
```

Abra por `localhost`: o navegador só libera o microfone em contexto seguro. Use fones de ouvido para o
microfone captar só a sua voz.

| Ferramenta | Para quê | Obrigatória |
| --- | --- | --- |
| `ffmpeg` / `ffprobe` | ler a mídia e estimar a melodia | sim |
| `yt-dlp` | importar do YouTube | só para YouTube |
| `whisper-ctranslate2` ou `whisper` | transcrever a letra offline (~100 idiomas) | não |
| `demucs` | separar a voz: playback instrumental e melodia mais precisa | não |

Variáveis: `PORT`, `HOST`, `SINGWITHME_DATA` (pasta de dados), `SINGWITHME_WHISPER_MODEL` (padrão `small`;
`medium`/`large-v3` erram menos em idiomas não europeus), `SINGWITHME_LRCLIB_URL` (instância própria do LRCLIB).

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

De 0 a 10.000 por música, comparando a nota cantada (detector YIN no navegador) com o alvo a cada 40 ms.
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
bun test
bun run typecheck
```

- `src/shared`: parsers (LRC, VTT, UltraStar), detector de afinação e pontuação, usados no servidor e no navegador.
- `src/server`: API HTTP (Bun), SQLite e o pipeline de importação.
- `src/web`: interface em React + Tailwind.
