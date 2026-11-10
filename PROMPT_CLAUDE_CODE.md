# Prompt para o Claude Code — Plataforma de Backlog e Progresso de Jogos

> **Como usar:** crie um repositório vazio, coloque este arquivo em `docs/PROMPT_CLAUDE_CODE.md`, abra o Claude Code na raiz do repo e mande:
> *"Leia `docs/PROMPT_CLAUDE_CODE.md` inteiro e execute a Fase 0. Pare ao final dela e me mostre o relatório."*
> Depois de revisar cada fase, peça a próxima ("execute a Fase 1", e assim por diante).

---

<papel>
Você é um engenheiro full-stack sênior especializado em aplicações TypeScript local-first, integrações com APIs de terceiros e produtos com IA. Você prioriza código simples, tipado e testado em vez de abstrações desnecessárias. Toda afirmação de progresso que você fizer deve se apoiar em resultados reais de ferramentas (testes rodados, comandos executados, telas verificadas).
</papel>

<visao_do_produto>
Uma plataforma **open source, local-first**, que qualquer pessoa baixa do GitHub e roda no próprio computador para gerenciar sua vida de jogadora: jogos zerados, jogando, backlog e wishlist, com notas e reviews, tempos do HowLongToBeat, conquistas, métricas de abandono, dicas sem spoiler, guias de 100%/platina e recomendações personalizadas.

Princípios inegociáveis:
1. **Roda 100% no PC do usuário.** Sem servidor nosso, sem conta, sem login. Os dados ficam num arquivo SQLite local.
2. **Traga sua própria IA (BYOK).** Cada usuário conecta a IA que já tem: assinatura via CLI (Claude Code, Codex, Gemini), chave de API (Anthropic, OpenAI, Gemini, OpenRouter) ou modelo local (Ollama/LM Studio). **Todas as funcionalidades precisam funcionar igual com qualquer provedor.**
3. **Dados primeiro, IA por último.** Tudo o que puder vir de fonte pública e determinística (APIs, wikis, estatísticas) vem dela. A IA só sintetiza, classifica e escreve. Objetivo explícito: **gastar o mínimo de tokens por sessão.**
4. **Funciona sem IA.** Biblioteca, HLTB, conquistas, funil de abandono, estatísticas e checklists funcionam sem nenhuma IA conectada. Funções de IA aparecem como "Conecte uma IA para liberar".
5. **Nunca perder dados.** Exportar/importar tudo em JSON versionado, para o usuário formatar o PC, reinstalar e importar tudo de volta.
</visao_do_produto>

<decisoes_travadas>
Estas decisões já foram tomadas. Não as reabra; se encontrar um bloqueio real, pare e pergunte.

- **Monorepo** com pnpm workspaces:
  - `apps/web`: React + Vite + TypeScript + Tailwind CSS
  - `apps/server`: Node + Fastify + TypeScript
  - `packages/shared`: tipos, schemas Zod e contratos compartilhados
- **Banco:** SQLite com **Drizzle ORM** + `better-sqlite3`. Motivo: mais leve que Prisma, sem binário de engine nem etapa de geração, inicialização rápida e menos atrito para quem instala. Migrações versionadas com drizzle-kit.
- **Validação:** Zod em todas as fronteiras (rotas HTTP, respostas de APIs externas, respostas da IA, import de JSON).
- **Testes:** Vitest (unitários e integração) + Playwright (fluxos principais na Fase 1 em diante).
- **Comando único:** `pnpm install && pnpm dev` sobe web + server. `pnpm build && pnpm start` roda a versão de produção local.
- **Idioma:** código, identificadores e commits em inglês. Interface em **pt-BR** por padrão, com i18n preparado (pt-BR e en) desde a Fase 1.
- **Licença:** MIT. README em pt-BR e en.
- **Dados do app:** pasta de dados do sistema operacional (ex.: `%APPDATA%/GameBacklog` no Windows, `~/Library/Application Support/GameBacklog` no macOS, `~/.local/share/GameBacklog` no Linux), configurável. Nunca dentro do repositório.
</decisoes_travadas>

<fontes_de_dados>
Use o máximo de fontes públicas para cruzar dados e reduzir o uso de IA. Cada fonte vira um **adaptador isolado** em `apps/server/src/sources/<fonte>/` com: cliente HTTP, schema Zod da resposta, normalização para o modelo interno, cache em SQLite com TTL, rate limiter e testes com respostas gravadas (fixtures). Antes de implementar cada adaptador, **consulte a documentação oficial atual** da fonte; não confie em endpoints de memória.

| Fonte | Uso | Observações |
|---|---|---|
| **IGDB** (via Twitch OAuth, client credentials) | Catálogo principal multiplataforma (PC, PS4/PS5, Switch, Xbox, retrô), capas, gêneros, temas, franquias, `similar_games`, plataformas | Credenciais do próprio usuário. Limite de ~4 req/s por client → fila com rate limit + cache agressivo. Uso gratuito não comercial. |
| **HowLongToBeat** | Tempos Main / Main+Extra / Completionist | **Sem API oficial.** Use uma biblioteca não oficial mantida (avalie as opções atuais) atrás de um adaptador que **pode falhar sem quebrar o app**: cache longo, retry com backoff e **campo manual editável** como fallback. Nunca bloqueie a UI esperando o HLTB. |
| **Steam Web API** | Biblioteca do usuário e horas jogadas (`GetOwnedGames`), conquistas do usuário (`GetPlayerAchievements`), schema de conquistas (`GetSchemaForGame`), **porcentagem global de cada conquista** (`GetGlobalAchievementPercentagesForApp`), jogados recentemente | Chave de API e SteamID do próprio usuário. Perfil precisa ser público para algumas rotas; detecte e explique quando não for. |
| **Steam Store** (`appdetails`) | Descrição, tags e categorias complementares | Endpoint público; respeite rate limit. |
| **RetroAchievements API** | Conquistas de jogos retrô | Chave do próprio usuário, opcional. |
| **RAWG API** | Fallback de catálogo/metadados quando o IGDB não tiver algo | Chave gratuita do usuário, opcional. |
| **PCGamingWiki** (API Cargo/MediaWiki) | Dados técnicos de PC, links de lojas, IDs cruzados | Público. |
| **Wikis Fandom / MediaWiki** (`api.php`) | Listas de colecionáveis, itens, capítulos, chefes, conquistas perdíveis | Público. Fonte principal de "contexto bruto" para a IA. Busque a wiki do jogo pelo nome. |
| **Reddit** | Discussões de "onde travei", dicas de chefe, perdíveis | Use a API oficial com OAuth do próprio usuário (opcional) ou deixe desativado. Respeite os termos. |
| **Busca web** | Encontrar guias, wikis e threads relevantes | Provedor configurável: **SearXNG** (local, grátis), **Brave Search API** ou **Tavily** (planos gratuitos). Opcional. |

Regras gerais de fontes:
- **Respeite termos de uso, robots.txt e rate limits.** Sem scraping de sites que proíbem (ex.: GameFAQs, PSNProfiles, Exophase); para esses, apenas links externos.
- **Conteúdo de terceiros:** o app **resume e linka** a fonte. Nunca copia detonados ou textos inteiros para a interface.
- Cada dado exibido guarda a **origem** (fonte + URL + data de coleta), e a UI mostra essa origem discretamente.
- **IDs cruzados:** a tabela `game_external_ids` liga o mesmo jogo entre IGDB, Steam, HLTB, RetroAchievements e RAWG. O match automático usa o ID da Steam presente no IGDB quando existir, e similaridade de nome + ano + plataforma; o usuário pode corrigir.
- **PSN e Xbox não têm API pública.** Para troféus/conquistas desses jogos, use a lista vinda das wikis + IA (marcada como "não oficial") ou entrada manual em checklist.
</fontes_de_dados>

<camada_de_ia>
Arquitetura em `apps/server/src/ai/`:

**1. Interface única de provedor** (`AiProvider`), com:
- `id`, `displayName`, `kind: 'cli' | 'api' | 'local'`
- `capabilities`: `{ structuredOutput, maxContextTokens, costHint: 'subscription' | 'pay-per-use' | 'free' }`
- `healthCheck()` → status + mensagem amigável
- `complete({ system, prompt, schema?, maxTokens, temperature })` → texto ou objeto validado por Zod

**2. Adaptadores:**
- **CLI (usa a assinatura do usuário):**
  - `ClaudeCodeCliProvider` → `claude -p`
  - `CodexCliProvider` → `codex exec`
  - `GeminiCliProvider` → Gemini CLI em modo não interativo
  - Regras: `spawn` sem shell, prompt via stdin, timeout configurável, cancelamento, e a CLI rodando no **modo mais restrito possível** (sem editar arquivos, sem executar comandos, sem ferramentas próprias, porque a busca é feita pelo app). Consulte a documentação atual de cada CLI para as flags corretas.
  - Detecte se a CLI está instalada e logada.
  - **Avise na UI se existir `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` no ambiente**, porque isso faz a CLI cobrar por API em vez de usar a assinatura.
- **API (pago por uso):** Anthropic, OpenAI, Google Gemini e OpenRouter, usando o **Vercel AI SDK** para unificar.
- **Local:** Ollama e LM Studio (endpoint compatível com OpenAI).

**3. Pipeline "dados primeiro":** toda função de IA segue esta ordem:
1. Verifica o **cache de IA** (chave = hash de função + jogo + checkpoint + objetivo + nível + versão do template de prompt).
2. Coleta contexto **determinístico** dos adaptadores de fontes: wiki, schema de conquistas da Steam, porcentagens globais, HLTB, resultados de busca já baixados e limpos.
3. Faz um **resumo e corte** do contexto: extrai só os trechos relevantes (por título de seção, palavras-chave e checkpoint), com orçamento máximo de tokens configurável.
4. Chama a IA com um **template de prompt versionado** (`apps/server/src/ai/prompts/*.ts`) que exige **JSON validado por Zod** e citação das fontes recebidas.
5. Se a validação falhar, faz 1 retry com o erro anexado; se falhar de novo, devolve erro amigável.
6. Salva no cache e registra no **log de uso**: provedor, tokens estimados, duração e acerto de cache. O log aparece numa tela de "Uso de IA".

**4. Configurações:** tela **"Conectar IA"** com: escolher provedor, colar chave (quando for API), botão **"Testar conexão"**, indicação de custo (assinatura / pago por uso / grátis), escolha de modelo e orçamento de tokens por requisição.
- Chaves salvas no keychain do sistema operacional (avalie uma lib mantida, ex.: `@napi-rs/keyring`) com fallback para arquivo de config na pasta de dados, com permissão restrita.
- **Nunca** salvar chaves no repositório, em logs, no export JSON ou em mensagens de erro.
</camada_de_ia>

<modelo_de_dados>
Desenhe o schema completo na Fase 0 já pensando em todas as fases, para evitar migrações destrutivas depois. Entidades mínimas:

- **games**: metadados normalizados (título, capa, plataformas, gêneros, temas, franquia, data de lançamento, descrição curta), com origem e data de coleta.
- **game_external_ids**: `(game_id, source, external_id)`.
- **game_times**: tempos do HLTB (main, main_extra, completionist), com origem (hltb/manual) e data.
- **library_entries**: jogo na biblioteca do usuário, com `status` (`playing`, `backlog`, `wishlist`, `completed`, `completed_100`, `paused`, `dropped`), plataforma em que joga, favorito e tags.
- **playthroughs**: **várias jogatinas por jogo**, com número/tipo (`normal`, `ng_plus`, `ng_plus_plus`, `custom`), **objetivo** (`finish`, `full_100`, `all_achievements`), datas de início e fim, horas, checkpoint atual e status próprio. Conquistas de NG+ (ex.: Dark Souls) se ligam à jogatina certa.
- **chapter_maps** / **checkpoints**: mapa de capítulos/áreas por jogo (ordem, nome, aliases, "ponto sem volta" sim/não), gerado uma vez e cacheado, com origem.
- **progress_events**: histórico de "onde estou", com o texto livre do usuário, o checkpoint resolvido e a data.
- **sessions**: diário de sessões (data, duração, nota livre, origem: manual/steam).
- **reviews**: por jogatina ou por jogo. Nota geral 0–10 (meio ponto) e **subnotas**: dificuldade, história, gameplay/mecânicas, mapa/level design, trilha sonora, visual, duração percebida. Mais texto, prós, contras, flag de spoiler, data e tempo para zerar (derivado da jogatina, editável).
- **achievements**: catálogo por jogo (origem: steam/retroachievements/wiki/ia/manual), com porcentagem global quando houver, flags `missable`, `story` (marca progresso de história) e `ng_plus`, e checkpoint relacionado.
- **achievement_progress**: por jogatina (desbloqueada, data, origem).
- **collectibles**: itens/segredos por checkpoint (origem wiki/ia/manual), com checklist por jogatina.
- **hints_cache**, **ai_cache**, **source_cache**: caches com TTL e versão.
- **ai_usage_log**, **settings**, **schema_meta** (versão do schema).
</modelo_de_dados>

<design>
O usuário pediu um visual **simplista**, que **não** pareça o estilo padrão genérico de dashboards gerados por IA.

- **Abertura:** a biblioteca já aberta, em **grade de capas** (proporção de capa de jogo), com filtros por status, plataforma e gênero, e busca no topo.
- **Três botões fixos e sempre visíveis:** **"Estou jogando"**, **"Vou jogar"** e **"Wishlist"**. Cada um abre a busca de jogo já com o status pré-selecionado.
- **Tema dark/light** com alternância manual e respeito à preferência do sistema. Defina tokens de cor em CSS variables. Nada de gradientes chamativos nem sombras pesadas: superfícies planas, bordas finas, uma cor de destaque, tipografia limpa (uma família sans), espaçamento generoso e as **capas dos jogos como o principal elemento visual**.
- **Página do jogo:** capa, tempos HLTB (3 barras com a posição estimada do usuário), status, seletor de jogatina, **"Onde estou?"** (campo de texto livre), objetivo da jogatina, e abas: **Progresso**, **Dicas**, **100% / Conquistas**, **Diário**, **Review**.
- **Spoiler shield:** todo conteúdo de dica além do nível permitido fica borrado até um clique explícito.
- Responsivo (funciona bem a partir de 375px de largura), acessível (contraste AA, foco visível, navegação por teclado) e com estados vazios amigáveis.
- Antes de codar a UI da Fase 1, entregue **um wireframe em texto** das telas principais e pare para aprovação.
</design>

<fases>

### Fase 0 — Fundação (pare ao final)
- Monorepo, tooling (ESLint, Prettier, TypeScript strict), scripts `dev`/`build`/`start`/`test`.
- Schema Drizzle completo (seção `<modelo_de_dados>`) + migração inicial + seed de exemplo.
- Esqueleto da interface `AiProvider` e da interface de adaptador de fonte (sem implementações reais ainda).
- `CLAUDE.md` na raiz, com: visão, decisões travadas, estrutura de pastas, comandos e convenções. Esse arquivo é a memória do projeto para as próximas sessões.
- `.env.example` (só nomes de variáveis, nunca valores), `.gitignore` cobrindo dados, chaves e caches.
- **Pronto quando:** `pnpm install && pnpm dev` sobe uma página "Hello" servida pelo server, `pnpm test` passa e a migração cria o banco na pasta de dados do SO.

### Fase 1 — MVP: biblioteca local completa, sem IA (pare ao final)
- **Assistente de primeira configuração:** explica passo a passo como criar as credenciais da Twitch/IGDB e, opcionalmente, chave e SteamID da Steam e as demais chaves opcionais. Tudo pode ser configurado ou pulado depois.
- Adaptadores **IGDB**, **HLTB** (com fallback manual) e **Steam**.
- Busca de jogos multiplataforma; adicionar com status; os três botões fixos; edição de status, plataforma e tags.
- Jogatinas (inclui NG+), objetivo da jogatina, campo "Onde estou?" (sem IA nesta fase: escolha manual de checkpoint ou texto livre salvo).
- **Importar biblioteca Steam:** jogos e horas, com revisão antes de confirmar.
- **Conquistas da Steam** por jogo, com porcentagem global.
- **Funil de abandono (versão determinística):** para jogos Steam, identifica conquistas de história por heurística (palavras como "chapter", "act", "complete", "defeat", e ordem por porcentagem decrescente) e mostra: *"De quem chegou onde você está, ~X% zerou"* e *"Faltam ~Yh (HLTB)"*. O usuário pode corrigir a classificação.
- **Review completa** com subnotas.
- **Diário de sessões** manual + sincronização de horas da Steam (diferença de playtime entre sincronizações vira sessão automática).
- **Exportar/importar JSON:**
  - Arquivo versionado (`schemaVersion`), validado por Zod, com migração de versões antigas.
  - Modos **substituir** e **mesclar** (com prévia do que vai mudar).
  - Opção de incluir ou não os caches. **Nunca** inclui chaves.
- **Backup automático** diário para uma pasta escolhida pelo usuário, mantendo os N mais recentes.
- Tema dark/light e i18n.
- **Pronto quando:** dá para cadastrar 10 jogos de plataformas diferentes, criar uma jogatina NG+, escrever uma review, exportar, apagar o banco, importar e ver tudo idêntico (teste automatizado de ida e volta). Playwright cobre: adicionar jogo, mudar status, exportar/importar.

### Fase 2 — IA: progresso, dicas e 100% (pare ao final)
- Adaptadores de IA (CLI, API, local) + tela "Conectar IA" + tela "Uso de IA".
- Adaptadores **Fandom/MediaWiki**, **PCGamingWiki**, **busca web** (SearXNG/Brave/Tavily) e **Reddit** (opcional).
- **Mapa de capítulos:** na primeira vez que o jogo recebe progresso, o app monta o mapa a partir da wiki + conquistas de história. A IA só organiza e preenche lacunas. Fica cacheado por jogo e é editável.
- **"Onde estou?" inteligente:** texto livre ("acabei de entrar na Árvore Deku") → checkpoint. Primeiro tenta match local por nome e aliases (sem IA); a IA entra só se não houver match.
- **Escada de dicas (anti-spoiler)**, acionada pelo botão **"Estou com dificuldade"** + campo opcional "onde travei":
  - Nível 1: empurrão
  - Nível 2: direção
  - Nível 3: dica específica
  - Nível 4: solução completa, atrás do spoiler shield
  - Cada nível é gerado só quando pedido.
  - **Puzzles** começam travados no nível 1–2 por padrão.
  - **Chefes** podem abrir direto em estratégia (padrões de ataque, fraquezas, preparação recomendada).
  - Toda dica mostra as fontes usadas.
- **Modo 100% / Platina** (conforme o objetivo da jogatina): por checkpoint, lista colecionáveis e segredos da área como checklist, e **conquistas perdíveis com alerta destacado** ("⚠️ ponto sem volta à frente"). O alerta aparece **antes** de o usuário registrar avanço para depois de um ponto sem volta.
- **Perguntas proativas** baseadas no checkpoint ("Quer dicas para o chefe desta área?"), geradas a partir dos dados da wiki, sem chamada extra de IA quando possível.
- **"Onde eu parei":** ao abrir um jogo pausado há mais de X dias, mostra um resumo curto e sem spoiler do último progresso, das últimas notas do diário e do próximo objetivo.
- **Funil de abandono com IA (fallback):** para jogos sem dados da Steam, estimativa a partir de fontes, **sempre marcada como estimativa**.
- **Pronto quando:** com qualquer provedor configurado (testar ao menos um CLI e o Ollama), o fluxo *"adicionar Ocarina of Time → objetivo 100% → 'acabei de entrar na Árvore Deku' → ver perdíveis e colecionáveis → pedir dica nível 1 e depois nível 2"* funciona. A segunda execução idêntica vem 100% do cache (0 tokens), e o log de uso mostra isso. Testes cobrem a validação de JSON da IA com respostas inválidas simuladas.

### Fase 3 — Recomendações (pare ao final)
- **Perfil de gosto** calculado localmente, sem IA: pesos por gênero, tema, franquia, plataforma e mecânica (tags), ponderados pelas notas das reviews e pelo status (zerado com nota alta pesa mais; dropado pesa negativo).
- Abas:
  - **"Parecidos com este jogo"**: `similar_games` do IGDB + similaridade de tags.
  - **"Parecidos com esta platina/100%"**: jogos com estrutura de conquistas parecida.
  - **"Do seu gênero favorito"**.
- **"O que jogar agora"**: ranqueia o **backlog** do usuário pela afinidade com o que ele já jogou e gostou, considerando também jogos pausados/dropados com bom potencial de retomada. Sem filtro por tempo disponível.
- A IA (opcional) só escreve uma linha explicando o porquê de cada recomendação, em lote e com cache.
- **Pronto quando:** com 15+ jogos avaliados no seed, as recomendações mudam de forma coerente ao alterar notas (teste unitário do ranqueamento), e tudo funciona sem IA conectada.

### Fase 4 — Extras e polimento (pare ao final)
- **Painel de estatísticas:**
  - Horas totais e por plataforma, gênero, ano e jogo
  - Jogos zerados por ano
  - **Tamanho do backlog em horas** (soma do HLTB conforme o objetivo de cada jogo)
  - Taxa de conclusão versus abandono
  - Sequências de sessões
  - Gráficos derivados do diário de sessões
  - Média das subnotas das reviews
- **Alerta de risco de drop:** jogo "jogando" parado há X dias ganha um empurrão ("faltam só 4h, você está a 80%").
- Integração **RetroAchievements** e fallback **RAWG**.
- Revisão de performance (virtualização da grade, índices no SQLite), acessibilidade e textos.
- README final (pt-BR/en) com instalação, configuração de cada chave e cada IA, screenshots, FAQ ("minha CLI está cobrando por API?", "como faço backup?").
- **Pronto quando:** todos os testes passam, o Lighthouse de acessibilidade fica ≥ 90 e uma instalação limpa seguindo só o README funciona.

</fases>

<regras_de_execucao>
- **Execute uma fase por vez.** Ao final de cada fase, **pare** e entregue um relatório com:
  - ✅ o que foi feito
  - arquivos principais criados/alterados
  - comandos de verificação rodados e seus resultados
  - limitações conhecidas
  - perguntas abertas
- Dentro da fase, trabalhe em passos pequenos, rode os testes a cada passo e faça **commits atômicos** com mensagens convencionais.
- **Pare e pergunte antes de:**
  - adicionar dependência fora da stack listada
  - mudar o schema do banco depois da Fase 1 sem migração não destrutiva
  - apagar arquivos
  - integrar uma fonte que exija scraping ou cujos termos de uso sejam duvidosos
  - qualquer decisão que contradiga `<decisoes_travadas>`
- **Implemente só o que está pedido em cada fase.** Sem features extras, sem autenticação, sem preços de jogos ou lojas (fora do escopo por enquanto).
- Se uma API externa não se comportar como esperado, documente o que observou, implemente o fallback descrito e siga. Não invente endpoints.
- Mantenha o `CLAUDE.md` atualizado ao fim de cada fase.
- Segredos: nunca escreva valores de chaves em código, testes, fixtures, logs ou commits.
</regras_de_execucao>

<criterio_de_sucesso_global>
Uma pessoa sem conhecimento do projeto clona o repositório, segue o README, conecta a IA que tiver (ou nenhuma) e consegue:
- montar sua biblioteca de jogos de várias plataformas
- acompanhar o progresso de cada jogatina
- receber dicas sem spoiler e guias de 100% com alertas de perdíveis
- ver estatísticas e recomendações
- exportar tudo, reinstalar e importar sem perder nada

Tudo isso sem nenhum servidor além do próprio computador.
</criterio_de_sucesso_global>
