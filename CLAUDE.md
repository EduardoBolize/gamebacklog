# GameBacklog

Memória do projeto para as próximas sessões. O plano completo, fase por fase, está em
[docs/PROMPT_CLAUDE_CODE.md](docs/PROMPT_CLAUDE_CODE.md) — leia a fase em que for trabalhar antes de começar.

## Visão

Plataforma **open source e local-first** para gerenciar a vida de jogadora: jogos zerados, jogando,
backlog e wishlist, com reviews, tempos do HowLongToBeat, conquistas, funil de abandono, dicas sem
spoiler, guias de 100% e recomendações.

Princípios inegociáveis:

1. **Roda 100% no PC do usuário.** Sem servidor nosso, sem conta, sem login. Dados num SQLite local.
2. **Traga sua própria IA (BYOK).** CLI com assinatura, chave de API ou modelo local. Toda função
   precisa funcionar igual com qualquer provedor.
3. **Dados primeiro, IA por último.** O que puder vir de fonte pública e determinística vem dela.
   A IA só sintetiza, classifica e escreve. Gastar o mínimo de tokens.
4. **Funciona sem IA.** Funções de IA aparecem como "Conecte uma IA para liberar".
5. **Nunca perder dados.** Exportar/importar tudo em JSON versionado.

## Estado atual

**Fases 0 a 4 concluídas**, com uma pendência: o fallback de catálogo pelo **RAWG** não foi
feito, porque o site e a API do RAWG estavam fora do ar (erro 522) e não foi possível conferir a
documentação. A chave do RAWG pode ser guardada, mas nada a usa.

O app tem: biblioteca local completa; contas da Steam, PlayStation e Xbox (importar jogos,
sincronizar conquistas e troféus) e RetroAchievements; IA opcional para mapa de capítulos,
"Onde estou?", dicas em quatro níveis e lista de colecionáveis por área; mapas e vídeos da área
vindos da wiki; recomendações calculadas localmente; painel de estatísticas; aviso de jogos
parados; README (pt-BR e en) e LICENSE (MIT, Eduardo Bolize).

Em stand-by por decisão do usuário (não integrar sem ele pedir):

- **Reddit:** os termos da API restringem o uso do conteúdo com IA; não foi integrado.
- **PCGamingWiki:** a API respondeu com um desafio anti-robô da Cloudflare; não foi integrado.

O que nunca rodou contra o serviço de verdade (só com respostas simuladas nos testes): PSN,
Xbox/OpenXBL e RetroAchievements, porque exigem a conta do usuário. Da IA, só o Claude Code
(CLI) foi testado com um modelo real ("Testar conexão", a explicação das recomendações e as
dicas); o mapa de capítulos e o checklist ainda não.

O Lighthouse não foi rodado (não está instalado; baixá-lo exige autorização do usuário). No
lugar, uma checagem própria de contraste, rótulos e nomes de controles passou sem falhas em
cinco telas, nos dois temas.

O desenho das telas da Fase 1 está em [docs/wireframes-fase-1.md](docs/wireframes-fase-1.md).

**Visual no estilo Steam em todo o app** (aprovado pelo usuário): a referência está em
`docs/design/` (imagem e HTML da ferramenta de design). A biblioteca (`/`) lê os dados reais, com
lateral de filtros e lista de jogos, "Continue jogando" e grade de capas clicáveis; a página do
jogo, Recomendações, Estatísticas e as demais telas usam a mesma barra do topo e a mesma paleta.

## Decisões travadas

Não reabrir. Diante de um bloqueio real, parar e perguntar.

- **Monorepo** com pnpm workspaces: `apps/web` (React + Vite + TypeScript + Tailwind),
  `apps/server` (Node + Fastify + TypeScript), `packages/shared` (tipos, schemas Zod, contratos).
- **Banco:** SQLite com Drizzle ORM + `better-sqlite3`. Migrações versionadas com drizzle-kit.
- **Validação:** Zod em todas as fronteiras (rotas HTTP, APIs externas, respostas da IA, import JSON).
- **Testes:** Vitest (unitários e integração) + Playwright (fluxos principais, da Fase 1 em diante).
- **Comando único:** `pnpm install && pnpm dev`; produção local com `pnpm build && pnpm start`.
- **Idioma:** código, identificadores e commits em inglês. Interface em pt-BR por padrão, com i18n
  (pt-BR e en) desde a Fase 1.
- **Licença:** MIT. README em pt-BR e en.
- **Dados do app:** pasta de dados do SO, configurável, **nunca dentro do repositório**.

## Decisões técnicas

- **Sem etapa de build no server.** O Node (>= 22.18) executa TypeScript direto, removendo os tipos.
  Vale em dev (`node --watch`) e em produção. Consequências que todo código do server e do shared
  precisa respeitar:
  - imports relativos **com extensão `.ts`**;
  - só sintaxe apagável (`erasableSyntaxOnly`): nada de `enum`, `namespace` ou parameter properties;
  - `import type` para tipos (`verbatimModuleSyntax`).
- **`packages/shared` é consumido como fonte** (`exports` aponta para `src/index.ts`), sem build.
- **TypeScript fixado em 6.0.x**: o typescript-eslint ainda não aceita a 7.
- **`better-sqlite3` >= 13** já traz binários prontos; `pnpm-workspace.yaml` impede o pnpm de tentar
  recompilar (o que exigiria toolchain C++).
- **IDs são UUID em texto**, para manter identidade no export/import e permitir mesclar instalações
  sem remapear IDs.
- **Server escuta só em `127.0.0.1`** (porta 3777). Em dev, o Vite (5173) faz proxy de `/api`.
- **Enums vivem em `packages/shared/src/enums.ts`** e são a única fonte de verdade para o schema
  Drizzle, os contratos HTTP e o formato de export.
- **Contratos HTTP em `packages/shared/src/contracts/`**: o server valida o que recebe e o web
  valida o que o server devolve, com os mesmos schemas.
- **Chaves e tokens só no cofre do sistema** (`@napi-rs/keyring`), com arquivo restrito na pasta de
  dados como reserva. Nunca na tabela `settings`, que é exportada.
- **Fontes atrás de interfaces** (`sources/types.ts`). As rotas recebem um `AppContext`; os testes
  montam um com fontes falsas (`test/context.ts`), então nenhum teste toca a rede.
- **HowLongToBeat** vem da biblioteca não oficial `howlongtobeat-ts`, com versão fixa. A busca roda
  em segundo plano depois de adicionar o jogo; se falhar, o usuário informa os tempos à mão.
- **"Onde estou?" sem IA** guarda o texto livre. A posição no funil de abandono é o marco de
  história mais raro já desbloqueado na jogatina.
- **Import em modo mesclar** casa linhas por chave primária e depois por chave natural (o mesmo
  jogo pelo ID na IGDB/Steam, a mesma jogatina pelo número…); em empate, vence o `updatedAt` mais
  novo e nada é removido. Preferências da máquina (pasta de backup, estado da sincronização da
  Steam) nunca vêm do arquivo.
- **i18n próprio** (`apps/web/src/i18n`), sem dependência: dicionários tipados, pt-BR como padrão e
  referência; `en.ts` só compila se tiver as mesmas chaves.
- **Visual único, escuro** (`index.css`): sem tema claro. Tokens em CSS variables expostos ao
  Tailwind (`bg`, `surface`, `line`, `text`, `muted`, `accent`, `topbar`, `sidebar`,
  `line-control`, `divider`, `soft`, `selected`, `status-*`); amarelo como destaque e uma cor por
  status. Títulos `h1`/`h2` em Barlow Condensed maiúsculo, o resto em Inter; as duas vêm dos
  pacotes `@fontsource/*` (só o subconjunto latino), empacotadas no build, sem acesso à internet.
- **Casca** (`components/Shell.tsx` + `TopBar.tsx`): abas Biblioteca, Jogando agora, Quero jogar,
  Wishlist (as três são `/?status=…`), Recomendações e Estatísticas; "Adicionar jogo" abre o
  diálogo no status que está na tela; sincronização da Steam com a hora da última; Ajustes. O
  botão de menu só aparece na biblioteca e controla a lateral, que abaixo de 768px vira gaveta.
- **Tela da Biblioteca** (`pages/library/`): todos os filtros vivem na URL (`q`, `status`,
  `platform` e `genre` repetíveis, `sort`, `hide`, `ach`, `fav`, `view`), então voltar de um jogo
  mantém o que estava filtrado. Plataformas são texto livre e a lateral as agrupa em famílias
  (`platformFamily`). Capa e nome abrem o jogo; "Dicas sem spoiler" abre `?tab=hints` e "Guia
  100% / platina" abre `?tab=achievements`. A lista da biblioteca (`GET /api/library`) traz
  `playedMinutes`, `lastPlayedAt`, `progressPercent` (horas contra o tempo do objetivo, 100 ao
  zerar), `achievementCount` e `accounts` (Steam, PSN…), calculados no server a cada pedido.
- **Web sem biblioteca de componentes nem de ícones**: controles nativos (`<dialog>`, `<select>`,
  `<details>`), ícones SVG próprios em `components/icons.tsx`.
- **Todo provedor de IA só precisa gerar texto** (`AiProviderCore.generate`). Saída estruturada é
  igual para todos: o prompt pede JSON, a resposta é extraída e validada com Zod
  (`defineProvider` em `ai/provider.ts`). Nenhum recurso depende de um provedor específico.
- **Toda função de IA passa por `runAiTask`** (`ai/pipeline.ts`): cache → coleta de contexto →
  corte no orçamento de tokens → prompt versionado → validação com uma nova tentativa → cache e
  log de uso. Pedido repetido custa zero tokens e aparece no log como acerto de cache.
- **Prompts versionados** em `ai/prompts/*.ts`, cada um com seu schema. Mudou o texto ou o schema,
  suba a versão: as respostas antigas deixam de valer.
- **CLIs de IA rodam sem shell**, com o prompt no stdin, numa pasta temporária vazia e com as
  flags mais restritas que cada uma documenta (`ai/providers/cli.ts`). No Windows, o atalho `.cmd`
  do npm é desfeito para `node script` para não precisar de shell.
- **APIs e modelos locais passam pelo Vercel AI SDK** (`ai/providers/api.ts`); OpenRouter, Ollama
  e LM Studio usam o protocolo compatível com OpenAI. Nenhum parâmetro de amostragem é enviado.
- **Sem IA conectada, nada quebra:** o texto do "Onde estou?" é guardado, o mapa pode ser escrito
  à mão e casado localmente, e o resumo "onde você parou" e as perguntas proativas são calculados
  só com dados do banco.
- **Wiki por jogo:** palpites de subdomínio do Fandom conferidos por uma busca, depois a busca web
  (se configurada), depois a Wikipedia; o usuário pode trocar. A escolha fica em `settings`.
- **Ponto sem volta:** avançar para uma etapa marcada assim devolve um aviso em vez de gravar; só
  grava com `confirmPointOfNoReturn`.
- **Formato de export na versão 5.** A 2 trouxe `checkpoints.bossName`; a 3 só marca que PSN e
  Xbox passaram a ser origens válidas; a 4 trouxe `checkpoints.leadsTo`, `checkpoints.requirement`
  e `playthroughs.completedCheckpointIds`; a 5, `collectibles.sourceName`, `achievementName`,
  `achievementId` e `locale`. Conversões em `EXPORT_MIGRATIONS`.
- **Checklist por área em duas listas** (`area-checklist.v3`): cada item diz a conquista ou o
  troféu para o qual conta (`achievementName`, e `achievementId` quando o app tem a conquista).
  Na tela: "Para conquistas" e "Para o 100%". Antes de pedir a lista, um jogo ligado a uma conta
  e nunca sincronizado tem as conquistas sincronizadas; sem conta nenhuma, a página de troféus da
  wiki entra no contexto. A lista de conquistas faz parte da chave de cache.
- **Idioma da lista guardada:** cada item sabe em que idioma foi escrito (`locale`); a lista só
  conta como gerada quando a tela está nesse idioma. Trocar de idioma reaplica a resposta
  (do cache, se já foi pedida naquele idioma) e casa os itens por `sourceName` (o nome nas
  fontes em inglês, igual em qualquer idioma), mantendo o que foi marcado. Itens da IA que a nova
  resposta não lista somem, a não ser que alguém já os tenha marcado.
- `collectibles.achievementId` é um ID solto, não chave estrangeira: as conquistas são
  substituídas na sincronização e na importação.
- **"Mapa de capítulos" virou "Rota do jogo"** na interface (o código continua `chapter_maps` e
  `checkpoints`). Mapa, para o usuário, é o mapa da wiki (aba Mapa). A rota tem ramificações:
  `leadsTo` aponta os IDs das áreas alcançáveis (vazio = a próxima pela posição) e `requirement`
  diz o que abre o caminho. Cada jogatina guarda as áreas terminadas em `completedCheckpointIds`.
  Refazer a rota mantém posição e áreas terminadas pelo nome.
- **O prompt da rota** (`chapter-map.v3`) usa a wiki primeiro e completa com o que é bem conhecido
  do jogo quando a wiki não lista as áreas (sem inventar), e pede ao menos um nome em português
  por área quando a interface está em pt-BR, para o "Onde estou?" casar sem IA.
- **"Onde estou?" lê várias áreas na mesma frase** (`readProgressLocally`): a marcada com
  "estou/agora/cheguei…" é a atual, ou a última citada; as outras viram terminadas. Só vai para a
  IA (`resolve-checkpoint.v2`, que também devolve `completed`) quando nada casa. Se não deu para
  posicionar, a resposta diz por quê (`notPlaced`, `aiError`).
- **Caminhos a partir daqui** (`assist/paths.ts`): as opções saem da rota, sem IA. A leitura da IA
  (`next-paths.v1`: como chegar, o que se perde em cada caminho, o que fazer antes de sair) só
  roda a pedido ou, na tela, logo depois que a jogatina muda de lugar. Os avisos apontam para as
  conquistas pelo número na lista; a aba de conquistas mostra a leitura guardada, nunca chama a IA.
- **Mapas das wikis** (`assist/maps.ts`, `sources/wiki/interactive-map.ts`): até 3 wikis por jogo
  (a escolhida, depois palpites no wiki.gg e na Fandom, inclusive com algarismo no lugar do
  romano: "darksouls2"), deduplicadas pelo endereço dos artigos. Lê os mapas interativos dos dois
  formatos abertos: Fandom Interactive Maps (`interactivemap`) e a extensão DataMaps do wiki.gg
  (`datamap`, marcadores pela API `queryDataMap`). Tudo vira posições de 0 a 1 sobre a imagem e é
  desenhado pela aba Mapa sem biblioteca (`InteractiveMapView`). Marcadores com o nome da área
  atual e das próximas são destacados. Fextralife e Map Genie não têm API aberta: não são usados.
- **IA sem cota** devolve o código `ai_usage_limit` (CLI: 429 ou texto de limite; API: 429), com
  mensagem que sugere esperar ou trocar o modelo em Ajustes › IA.
- **PSN é não oficial e opcional** (`sources/psn/`): usa os endereços do app oficial da
  PlayStation com o token NPSSO que o usuário copia da própria sessão. Só leitura. O token e o
  refresh token ficam no cofre; a tela de ajustes e o README avisam que foge dos termos da Sony.
  As requisições seguem o projeto comunitário `psn-api`, sem tê-lo como dependência.
- **Xbox passa pelo OpenXBL** (`sources/xbox/`), serviço de terceiros: a chave é do usuário e os
  dados passam pelo servidor deles (avisado na tela). 150 consultas por hora no plano grátis.
- **Importação de console reaproveita a tela da Steam** (`consoles/service.ts`, rota
  `/import/:fonte`). Console só dá o nome do jogo, então a busca na IGDB acontece na importação,
  por título exato depois de limpo, preferindo o lançamento naquele console. Jogo que já está na
  biblioteca é vinculado, nunca duplicado.
- **Uma sincronização de conquistas para todas as contas** (`achievements/service.ts`,
  `syncAchievements`): Steam, PSN, Xbox e RetroAchievements viram a mesma lista. Com o jogo em
  mais de uma conta, vale a da plataforma em que o usuário joga (`achievementLinkFor`).
- **RetroAchievements é vinculado à mão**: a API não busca por nome, então o usuário cola o
  número ou o endereço da página do jogo. As marcações de progressão e perdível do próprio site
  valem mais que a heurística de nomes.
- **Todo texto de IA sai no idioma da interface** (`ai/prompts/language.ts`): a regra diz
  explicitamente "seja qual for o idioma das fontes" e manda manter nomes próprios como o jogo
  escreve. Todo prompt novo com texto para o usuário deve usar `languageRule` e levar o
  `locale` na chave de cache.
- **Dicas (`hint.v3`)**: a IA recebe a identidade do jogo (ano, nomes alternativos, plataforma
  da jogatina) e nunca pergunta a versão. Fontes primeiro; quando não cobrem o trecho, ela
  responde com o que sabe do jogo, sem inventar, e diz isso em `basis` (`sources`/`knowledge`):
  a tela mostra "Do que a IA sabe deste jogo" em vez de fontes. Cada nível recebe os níveis já
  abertos para ir um passo além. Dicas de versões antigas do prompt não aparecem mais.
- **Wiki geral (Wikipedia)**: toda busca leva o título do jogo e só entram páginas que citam o
  jogo (`isGeneralWiki`, `collectWikiDocs`); as dicas leem antes as wikis do jogo no Fandom e no
  wiki.gg (`findGameWikis`), e a aba de mídia não busca imagens de área na Wikipedia.
- **Mapas e vídeos não usam IA** (`assist/media.ts`): mapas são arquivos de imagem que a wiki do
  jogo já tem, escolhidos pelo nome, mostrados como miniatura com link para a página do arquivo
  na wiki; vídeos são resultados do YouTube pela busca web (se houver) mais um link de busca
  pronto. Nada é buscado antes de a seção ser aberta.
- **Estatísticas e avisos de jogo parado** (`stats/service.ts`) são contados do que já está no
  banco, sem fonte nem IA. Horas vêm das jogatinas; o diário entra quando a jogatina não tem
  horas, e é a única origem de datas. O prazo do aviso é a configuração `nudge.after_days` (14).
- **Gráficos sem biblioteca**: barras em HTML e CSS, uma cor só (a de destaque), todo valor
  escrito ao lado da barra, de modo que a lista também serve de tabela.
- **Grade da biblioteca**: os cartões usam `content-visibility: auto` (`.game-card`), então o
  navegador só desenha os que estão perto da tela. Não há virtualização por JavaScript.
- **Recomendações não guardam nada no banco**: tudo é recalculado a cada pedido a partir da
  biblioteca (`recommendations/`). A Fase 3 não mudou o schema nem o formato de export.
- **Perfil de gosto** (`recommendations/profile.ts`, funções puras): cada jogo com opinião vira um
  peso de -1,5 a 1,5 a partir da nota (6 é neutro) e do status (zerado pesa mais, dropado pesa
  contra, backlog e wishlist não contam). Cada gênero, tema, franquia, plataforma e mecânica
  recebe a média desses pesos, puxada para zero enquanto há poucos jogos. Um jogo da biblioteca
  nunca conta como evidência a favor de si mesmo (`excludeEntryId`).
- **Toda recomendação carrega seus motivos** (`reasons`: característica + jogos que a
  sustentam), calculados localmente. A IA só transforma esses motivos em uma linha por jogo,
  num único pedido por lista, quando o usuário clica; a chave de cache inclui os motivos, então
  a linha some quando o perfil muda.
- **"Parecidos"** junta o `similar_games` da IGDB com a sobreposição de gêneros, temas e
  mecânicas (`recommendations/similarity.ts`). **"Parecidos com esta platina"** compara o
  formato da lista de conquistas (tamanho, mediana, raridade); fora da biblioteca só entram
  jogos com conquistas na Steam, porque as porcentagens globais da Steam não exigem chave.
- **IGDB fora do ar ou sem chave nunca quebra uma lista**: a resposta diz o que faltou
  (`catalog`: `ok`, `not_configured`, `no_catalog_id`, `failed`) e mostra o que a biblioteca tem.

## Estrutura de pastas

```
apps/
  server/
    drizzle/                 migrações SQL geradas (versionadas no git; não editar à mão)
    drizzle.config.ts        usado só por `pnpm db:generate`
    src/
      index.ts               entrada: .env → config → banco → migrações → Fastify → backup diário
      app.ts                 buildApp(): rotas + web estática em produção
      context.ts             AppContext: banco, cofre, fontes e relógio
      config.ts, paths.ts    host, porta, pasta de dados por SO, trava "fora do repositório"
      errors.ts              HttpError e o tradutor de erros para `{ error, message }`
      routes/                rotas HTTP por área (library, achievements, sources, transfer,
                             ai, assist, recommendations, stats)
      library/               biblioteca, jogatinas, tempos, diário, reviews, "onde estou"
      achievements/          sincronização da Steam, heurística de história, funil de abandono
      steam/                 prévia e importação da biblioteca, sincronização de horas
      transfer/              exportar, importar (substituir/mesclar) e backup
      sources/               adapter.ts, types.ts, http, rate limiter, cache
        igdb/ steam/ hltb/   um adaptador por pasta, com schema, normalização, testes e fixtures
        wiki/ web-search/    MediaWiki (Fandom, Wikipedia…) e busca web (SearXNG, Brave, Tavily)
        psn/ xbox/           contas de console: jogos e troféus/conquistas
        retroachievements/   conquistas de jogos retrô
      secrets/               cofre de chaves (keychain, arquivo, memória)
      settings/              registro tipado do que vai na tabela `settings`
      ai/                    provider.ts (contrato), cli.ts (execução sem shell), pipeline.ts,
                             service.ts (provedor ativo), providers/ (cli, api) e prompts/
      consoles/              prévia e importação da biblioteca da PSN e do Xbox
      stats/                 painel de estatísticas e avisos de jogo parado
      recommendations/       profile.ts (perfil de gosto), similarity.ts (parecidos e formato
                             das conquistas), service.ts (as listas e a explicação por IA)
      assist/                wiki do jogo, rota (chapter-map), "onde estou", caminhos a partir
                             daqui (paths), mapas das wikis (maps), dicas, checklist de 100%,
                             resumo e estimativa de abandono
      db/                    client, migrate, seed, cli/, schema/
      test/                  helpers de teste: banco em memória, fetch falso, app com fontes falsas
  web/
    src/
      App.tsx                rotas
      api.ts, api-assist.ts, api-recommendations.ts
                             cliente HTTP + hooks do TanStack Query (biblioteca / IA /
                             recomendações)
      index.css              tokens do visual escuro e classes base (btn, field, panel…)
      i18n/                  pt-BR.ts, en.ts e o provider
      components/            Shell e TopBar (casca e barra do topo), icons, AddGameDialog, SourceForms, AiSettings,
                             Spoiler (spoiler shield), Recommendations (lista, motivos e
                             "Explicar com IA"), ui
      pages/library/         a Biblioteca: Sidebar, Continue jogando, grade/lista, filtros
                             puros e a URL em filters.ts
      pages/                 Game (+ game/ com as abas), Setup, SteamImport (a tela
                             de importação de Steam, PSN e Xbox), Settings, AiUsage,
                             Recommendations, Stats
packages/
  shared/src/                enums, constantes, proveniência e contracts/
e2e/                         testes Playwright (rodam sobre a biblioteca de exemplo do seed) e
                             fake-llm.mjs (IA de mentira para os testes)
docs/                        plano das fases, wireframes e screenshots/ (capturas do README)
```

Destino das próximas fases: novas fontes em `apps/server/src/sources/<fonte>/`; novas funções de
IA como um prompt em `ai/prompts/` mais uma chamada a `runAiTask`.

## Comandos

Todos a partir da raiz.

| Comando                       | O que faz                                                         |
| ----------------------------- | ----------------------------------------------------------------- |
| `pnpm install`                | Instala tudo                                                      |
| `pnpm dev`                    | Sobe web (http://127.0.0.1:5173) e server (http://127.0.0.1:3777) |
| `pnpm build`                  | Typecheck de tudo + build do web                                  |
| `pnpm start`                  | Produção local: o server serve o web em http://127.0.0.1:3777     |
| `pnpm test`                   | Vitest em todos os pacotes                                        |
| `pnpm test:e2e`               | Playwright contra o build de produção, em pasta de dados própria  |
| `pnpm typecheck`              | `tsc --noEmit` em todos os pacotes                                |
| `pnpm lint`                   | ESLint                                                            |
| `pnpm format`                 | Prettier (`pnpm format:check` só verifica)                        |
| `pnpm db:generate --name <x>` | Gera migração a partir de mudanças no schema                      |
| `pnpm db:migrate`             | Cria/atualiza o banco na pasta de dados                           |
| `pnpm db:seed`                | Insere os dados de exemplo (não sobrescreve nada)                 |

O server também aplica as migrações pendentes sozinho ao iniciar.

## Dados e configuração

- Banco: `gamebacklog.sqlite` dentro da pasta de dados — `%APPDATA%/GameBacklog` (Windows),
  `~/Library/Application Support/GameBacklog` (macOS), `~/.local/share/GameBacklog` (Linux).
- Variáveis opcionais (ver `.env.example`; o `.env` fica na raiz): `GAMEBACKLOG_DATA_DIR`
  (use caminho absoluto), `GAMEBACKLOG_HOST`, `GAMEBACKLOG_PORT`, `GAMEBACKLOG_SECRET_STORE`
  (`file` força o arquivo em vez do cofre do sistema).
- Para experimentar sem tocar na biblioteca real, aponte `GAMEBACKLOG_DATA_DIR` para uma pasta
  temporária fora do repositório.

## Convenções

- **Schema:** nomes de tabela e coluna em `snake_case`; instantes em epoch ms (`timestamp_ms`);
  datas de calendário em texto `YYYY-MM-DD`; durações em minutos inteiros; listas em JSON.
  Helpers em `db/schema/columns.ts`.
- **Mudou o schema?** Rode `pnpm db:generate --name <descricao>` e versione o SQL gerado. Depois da
  Fase 1, só migrações não destrutivas. Se o formato dos dados exportados mudar, suba
  `DATA_SCHEMA_VERSION` em `packages/shared/src/constants.ts`.
- **Origem dos dados:** todo dado exibido guarda fonte + URL + data de coleta (`origin`,
  `origin_url`, `fetched_at`, ou uma lista `sources`).
- **Correções do usuário vencem** dados automáticos (`matched_by = 'user'`,
  `classified_by = 'user'`, `is_user_edited`): nunca sobrescrever.
- **Testes** ficam ao lado do código (`*.test.ts`). Testes de banco usam `:memory:` ou pasta
  temporária; nunca a pasta de dados real. Testes de rota usam `createTestApp()`.
- **Seed** (`db/seed.ts`): biblioteca de exemplo com 27 jogos, 17 deles avaliados. Os testes
  de ranqueamento e os testes Playwright dependem dela; ao mexer no seed, rode os dois.
- **Testes de IA** usam a IA roteirizada de `createTestApp()` (`t.ai.answers`, `t.ai.requests`)
  e a wiki falsa (`t.sources.wikiPages`). Por padrão a IA vem desconectada: ligue com
  `t.ai.connected = true`.
- **Spoilers:** nomes de etapas futuras, a solução completa (nível 4) e a próxima etapa do resumo
  ficam atrás do `<Spoiler>` até um clique.
- **Texto de interface** sempre pelo i18n (`t('chave')`), nas duas línguas. O server devolve
  códigos de erro (`error`), e o web traduz em `errors.<código>`.
- **Listas ordenadas** levam um critério de desempate estável (o `id`), para que a ordem não mude
  depois de um export/import.
- **Coluna nova no banco?** Atualize também `packages/shared/src/contracts/export.ts`; o teste de
  ida e volta falha enquanto os dois não baterem.
- **Segredos:** nunca em código, testes, fixtures, logs, commits, na tabela `settings` ou no export
  JSON. Mensagens de erro de fontes e de IA nunca incluem chaves.
- **Fontes externas:** consultar a documentação oficial atual antes de implementar; respeitar termos
  de uso e rate limits; sem scraping de sites que proíbem. Uma fonte que falha nunca quebra o app.
- **Commits:** atômicos, mensagens convencionais em inglês, **sem linha de coautoria**: o
  usuário é o único autor no histórico.

## Regras de execução

- Uma fase por vez. Ao final, parar e entregar relatório: o que foi feito, arquivos principais,
  comandos de verificação e resultados, limitações conhecidas, perguntas abertas.
- Implementar só o que a fase pede. Sem features extras, sem autenticação, sem preços ou lojas.
- **Parar e perguntar antes de:** adicionar dependência fora da stack; mudar o schema depois da
  Fase 1 sem migração não destrutiva; apagar arquivos; integrar fonte que exija scraping ou tenha
  termos duvidosos; qualquer coisa que contradiga as decisões travadas.
- Manter este arquivo atualizado ao fim de cada fase.
