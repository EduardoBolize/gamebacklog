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

**Fases 0 e 1 concluídas.** O app é uma biblioteca local completa, sem IA: busca e cadastro de
jogos, jogatinas, diário, reviews, conquistas da Steam, funil de abandono, importação da Steam,
exportar/importar JSON e backup diário. Próxima: Fase 2 (IA: progresso, dicas e 100%).

Ainda não existe: nenhum provedor de IA (só a interface), mapa de capítulos gerado, dicas,
adaptadores de wiki/busca/Reddit, RAWG e RetroAchievements (as chaves já podem ser guardadas, mas
nada as usa), README e LICENSE.

O desenho das telas aprovado está em [docs/wireframes-fase-1.md](docs/wireframes-fase-1.md).

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
- **Web sem biblioteca de componentes nem de ícones**: controles nativos (`<dialog>`, `<select>`,
  `<details>`), tokens em CSS variables (`index.css`) e uma única cor de destaque.

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
      routes/                rotas HTTP por área (library, achievements, sources, transfer)
      library/               biblioteca, jogatinas, tempos, diário, reviews, "onde estou"
      achievements/          sincronização da Steam, heurística de história, funil de abandono
      steam/                 prévia e importação da biblioteca, sincronização de horas
      transfer/              exportar, importar (substituir/mesclar) e backup
      sources/               adapter.ts, types.ts, http, rate limiter, cache
        igdb/ steam/ hltb/   um adaptador por pasta, com schema, normalização, testes e fixtures
      secrets/               cofre de chaves (keychain, arquivo, memória)
      settings/              registro tipado do que vai na tabela `settings`
      ai/provider.ts         interface AiProvider (só esqueleto)
      db/                    client, migrate, seed, cli/, schema/
      test/                  helpers de teste: banco em memória, fetch falso, app com fontes falsas
  web/
    src/
      App.tsx                rotas
      api.ts                 cliente HTTP + hooks do TanStack Query
      theme.tsx, index.css   tema claro/escuro e tokens
      i18n/                  pt-BR.ts, en.ts e o provider
      components/            Shell (casca + 3 botões), AddGameDialog, SourceForms, ui
      pages/                 Library, Game (+ game/ com as abas), Setup, SteamImport, Settings
packages/
  shared/src/                enums, constantes, proveniência e contracts/
e2e/                         testes Playwright
docs/                        plano das fases e wireframes
```

Destino das próximas fases: novas fontes em `apps/server/src/sources/<fonte>/`; provedores e
templates de prompt em `apps/server/src/ai/` (`prompts/*.ts`).

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
- **Commits:** atômicos, mensagens convencionais em inglês.

## Regras de execução

- Uma fase por vez. Ao final, parar e entregar relatório: o que foi feito, arquivos principais,
  comandos de verificação e resultados, limitações conhecidas, perguntas abertas.
- Implementar só o que a fase pede. Sem features extras, sem autenticação, sem preços ou lojas.
- **Parar e perguntar antes de:** adicionar dependência fora da stack; mudar o schema depois da
  Fase 1 sem migração não destrutiva; apagar arquivos; integrar fonte que exija scraping ou tenha
  termos duvidosos; qualquer coisa que contradiga as decisões travadas.
- Manter este arquivo atualizado ao fim de cada fase.
