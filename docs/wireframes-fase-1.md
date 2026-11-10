# Wireframes — Fase 1

Rascunho em texto das telas principais da Fase 1, para aprovação **antes** de codar a UI.
Os textos são os da interface em pt-BR. Tudo aqui é proposta: o que você mudar, eu sigo.

## Linguagem visual

- **As capas são o visual.** Fora delas, a interface é texto e linhas.
- Superfícies planas, borda de 1px, cantos de 4px. Sem gradiente, sem sombra, sem cartões de
  "estatística" no topo, sem barra lateral de ícones.
- **Uma família sans do próprio sistema** (`system-ui`). Nenhuma fonte baixada da internet.
- **Uma cor de destaque**, usada só em: ação principal, item selecionado, foco e posição do usuário
  nas barras de tempo. Proposta: laranja queimado. Todo o resto é escala de cinza.
- Tema claro e escuro por CSS variables; segue o sistema e tem alternância manual.
- Ícones: quase nenhum. Rótulos em texto. Os poucos necessários (buscar, fechar, favorito) são SVG
  embutido, sem biblioteca de ícones.
- Foco de teclado sempre visível; contraste AA; alvo de toque mínimo de 44px.

## Casca global (em todas as telas)

Barra superior fixa. Os três botões ficam sempre visíveis: na barra em telas largas, numa barra
inferior fixa em telas estreitas.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ GameBacklog    [ Estou jogando ] [ Vou jogar ] [ Wishlist ]   Tema  Ajustes │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Estou jogando** → abre "Adicionar jogo" com status _Jogando_.
- **Vou jogar** → abre com status _Backlog_.
- **Wishlist** → abre com status _Wishlist_.
- "GameBacklog" volta para a biblioteca.

---

## 1. Biblioteca (tela inicial)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ GameBacklog    [ Estou jogando ] [ Vou jogar ] [ Wishlist ]   Tema  Ajustes │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  [ Buscar na biblioteca…                                               ]   │
│                                                                            │
│  Todos 42   Jogando 3   Backlog 18   Wishlist 6   Zerados 11   100% 2      │
│  ───────    Pausados 1   Dropados 1                                        │
│                                                                            │
│  Plataforma: todas ▾    Gênero: todos ▾    Só favoritos ☐    Ordem: ▾      │
│                                                                            │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐    │
│  │        │  │        │  │        │  │        │  │        │  │        │    │
│  │  capa  │  │  capa  │  │  capa  │  │  capa  │  │  capa  │  │  capa  │    │
│  │  3:4   │  │        │  │        │  │        │  │        │  │        │    │
│  │        │  │        │  │        │  │        │  │        │  │        │    │
│  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘    │
│  Dark Souls  Ocarina of  Hollow      Celeste     Hades       Metroid Pr…   │
│  Jogando·PC  Jogando·N64 Zerado·PC   Pausado·Sw  Backlog·PC  Wishlist·Sw   │
│                                                                            │
│  ┌────────┐  ┌────────┐  …                                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

- Filtro de status é uma linha de texto com contagem; o selecionado ganha sublinhado na cor de
  destaque. Não são "pílulas" coloridas.
- Plataforma e gênero são selects simples, com as opções que existem na biblioteca.
- Ordem: adicionado recentemente (padrão), título, lançamento, nota, tempo para zerar.
- Cada item: capa, título em uma linha (corta com reticências), status e plataforma em cinza.
- Clique na capa abre a página do jogo. Foco ou hover mostra um "⋯" no canto com: mudar status,
  favoritar, remover da biblioteca.
- Jogo sem capa: retângulo liso com o título escrito dentro.
- Filtros e busca ficam na URL, então voltar do jogo mantém o que estava filtrado.

**Celular (375px):** duas capas por linha; filtros de status rolam na horizontal; plataforma,
gênero e ordem vão para um "Filtros ▾"; os três botões descem para a barra inferior fixa.

```
┌───────────────────────────────────┐
│ GameBacklog          Tema  Ajustes │
├───────────────────────────────────┤
│ [ Buscar na biblioteca…         ] │
│ Todos 42  Jogando 3  Backlog 18 → │
│ Filtros ▾                         │
│ ┌──────────────┐ ┌──────────────┐ │
│ │     capa     │ │     capa     │ │
│ │              │ │              │ │
│ └──────────────┘ └──────────────┘ │
│ Dark Souls       Ocarina of Time  │
│ Jogando · PC     Jogando · N64    │
│ ┌──────────────┐ ┌──────────────┐ │
├───────────────────────────────────┤
│ Estou jogando │ Vou jogar │ Wishl. │
└───────────────────────────────────┘
```

**Biblioteca vazia:**

```
        Sua biblioteca está vazia.

        Comece por um jogo que você está jogando agora,
        ou traga tudo de uma vez da Steam.

        [ Adicionar um jogo ]    [ Importar da Steam ]
```

---

## 2. Adicionar jogo

Diálogo sobre a tela atual (tela cheia no celular). O campo de busca já vem com foco.

```
┌──────────────────────────────────────────────────────────────┐
│ Adicionar jogo                                         Fechar │
│                                                              │
│ [ zelda ocarina                                           ]  │
│                                                              │
│ Adicionar como:  (•) Jogando  ( ) Backlog  ( ) Wishlist      │
│                  ( ) Zerado   ( ) Outro ▾                    │
│ ──────────────────────────────────────────────────────────── │
│ ┌────┐ The Legend of Zelda: Ocarina of Time                  │
│ │capa│ 1998 · Nintendo 64, GameCube, Wii                     │
│ └────┘ Plataforma: [ Nintendo 64 ▾ ]            [ Adicionar ] │
│ ──────────────────────────────────────────────────────────── │
│ ┌────┐ The Legend of Zelda: Ocarina of Time 3D               │
│ │capa│ 2011 · Nintendo 3DS                                   │
│ └────┘ Plataforma: [ Nintendo 3DS ▾ ]           [ Adicionar ] │
│ ──────────────────────────────────────────────────────────── │
│ ┌────┐ The Legend of Zelda: Majora's Mask                    │
│ │capa│ 2000 · Nintendo 64          Já está na biblioteca →   │
│ └────┘                                                       │
│                                                              │
│ Fonte: IGDB                    Não achou? Adicionar à mão →  │
└──────────────────────────────────────────────────────────────┘
```

- O status vem pré-selecionado conforme o botão que abriu o diálogo.
- "Adicionar" troca para "Adicionado · abrir" e o diálogo continua aberto, para adicionar vários.
- Tempo do HLTB é buscado em segundo plano depois de adicionar; nunca trava este diálogo.
- **Sem IGDB configurada:** no lugar dos resultados, uma explicação curta com "Configurar IGDB" e
  "Adicionar à mão" (título, plataforma, ano). É o que mantém o app utilizável sem nenhuma chave.

---

## 3. Página do jogo

```
┌────────────────────────────────────────────────────────────────────────────┐
│ GameBacklog    [ Estou jogando ] [ Vou jogar ] [ Wishlist ]   Tema  Ajustes │
├────────────────────────────────────────────────────────────────────────────┤
│ ← Biblioteca                                                               │
│                                                                            │
│ ┌──────────┐  Dark Souls: Remastered                          ☆ Favoritar  │
│ │          │  2018 · RPG · fonte: IGDB                                     │
│ │          │                                                               │
│ │   capa   │  Status [ Jogando ▾ ]   Plataforma [ PC ▾ ]   Tags: + tag     │
│ │          │                                                               │
│ │          │  Jogatina [ 2 · NG+ ▾ ]  + Nova     Objetivo [ Conquistas ▾ ] │
│ └──────────┘                                                               │
│                                                                            │
│ Tempo para zerar                                    você: 9h nesta jogatina │
│ História          ▓▓▓▓│░░░░░░░░░░░                                    30h  │
│ História + extras ▓▓▓▓│░░░░░░░░░░░░░░░░░░                             46h  │
│ Completo          ▓▓▓▓│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                  70h  │
│ HowLongToBeat · coletado em 03/11 · editar tempos                          │
│                                                                            │
│ Onde estou?                                                                │
│ [ escreva onde você está, do seu jeito…                        ] [ Salvar ] │
│ Último marco de história: [ Ring the Bell (Undead Church) ▾ ]              │
│                                                                            │
│ Progresso    Dicas    100% / Conquistas    Diário    Review                │
│ ─────────                                                                  │
│ (conteúdo da aba)                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Barras de tempo:** três barras na mesma escala (a mais longa ocupa a largura toda). O traço
  vertical na cor de destaque é a posição do usuário. Se passou do tempo, o traço encosta no fim e
  o rótulo vira "9h a mais". A barra do objetivo atual fica com o rótulo em negrito.
- Sem dados do HLTB: "Tempo ainda não encontrado · informar manualmente". A página nunca espera
  o HLTB para aparecer.
- **Jogatina:** o seletor lista "1 · Primeira", "2 · NG+"… "+ Nova" pede tipo (normal, NG+, NG++,
  personalizada com nome) e objetivo (zerar, 100%, todas as conquistas).
- **Onde estou?** Nesta fase não há IA: o texto é salvo como está, com data. "Último marco de
  história" só aparece quando o jogo tem conquistas de história; vem preenchido pelo que já foi
  desbloqueado e pode ser trocado à mão.
- Todo dado vindo de fora mostra a origem em cinza pequeno ("fonte: IGDB", "HowLongToBeat ·
  coletado em…").
- **Celular:** capa menor à esquerda do título; os seletores empilham; as abas rolam na horizontal.

### 3a. Aba Progresso

```
 De quem chegou onde você está, ~38% zerou.
 Faltam ~21h para zerar (HowLongToBeat, História).

 Marcos de história                                  % dos jogadores
 ✓ Ring the Bell (Undead Church)   ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░   60%   ← você
   Ring the Bell (Quelaag's Domain) ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░   45%
   Lordvessel                       ▓▓▓▓▓▓░░░░░░░░░░░░░░   32%
   To Link the Fire                 ▓▓▓▓░░░░░░░░░░░░░░░░   23%
 Marcos detectados automaticamente · corrigir

 Histórico
 29/10  "acabei de tocar o primeiro sino"       Ring the Bell (Undead Church)
 22/10  "cheguei no Burgo dos Mortos-Vivos"     —

 Jogatina
 Início [ 15/09/2026 ]   Fim [ — ]   Horas [ 9 ]   Status [ Jogando ▾ ]
```

- As duas frases do topo são o funil de abandono. Só aparecem para jogos com conquistas da Steam;
  nos demais, a seção explica em uma linha por que não há estimativa.
- "corrigir" leva à aba de conquistas já filtrada em "História".

### 3b. Aba Dicas

Nesta fase, só o estado bloqueado:

```
 Dicas sem spoiler

 Conecte uma IA para liberar dicas em quatro níveis, do empurrão à solução.
 Disponível em uma próxima versão.
```

### 3c. Aba 100% / Conquistas

```
 23 de 41 desbloqueadas · 56%            Steam · sincronizado há 2h · Sincronizar

 Todas 41    Faltam 18    História 6    Perdíveis 4

 ✓ Ring the Bell (Undead Church)                    história        60,2%
   Toque o primeiro Sino do Despertar.               10/05/2026
 ─────────────────────────────────────────────────────────────────────────
 ☐ Knight's Honor                                   perdível · NG+   4,8%
   Adquira todas as armas raras.                                     ⋯
 ─────────────────────────────────────────────────────────────────────────
 ☐ Conquista oculta                                                 12,1%
   Mostrar descrição
```

- Ordem padrão: porcentagem global decrescente.
- "⋯" abre "Classificar": história, perdível, NG+. O que o usuário marcar nunca é sobrescrito pela
  heurística.
- Descrição de conquista oculta fica escondida até um clique.
- Jogo sem conquistas da Steam: "Este jogo não tem conquistas da Steam vinculadas."
- Perfil privado ou chave inválida: mensagem dizendo exatamente o que ajustar e onde.

### 3d. Aba Diário

```
 9h 10min nesta jogatina · 5 sessões                      [ Registrar sessão ]

 29/10/2026 · 1h 10min
 Entrei na Árvore Deku.

 28/10/2026 · 1h 20min
 Peguei a espada e o escudo na Floresta Kokiri.

 15/09/2026 · 2h · Steam, automática
```

- "Registrar sessão": data, duração, nota livre. Editar e apagar em cada linha.
- Sessões criadas pela sincronização da Steam aparecem marcadas e aceitam nota depois.

### 3e. Aba Review

```
 Review de: (•) esta jogatina   ( ) o jogo como um todo

 Nota geral           [ – ]  9,5  [ + ]      ──────────────────●─
 Dificuldade          [ – ]  8,0  [ + ]      ───────────────●────
 História             [ – ]  8,5  [ + ]      ────────────────●───
 Gameplay             [ – ]  9,5  [ + ]      ──────────────────●─
 Mapa / level design  [ – ] 10,0  [ + ]      ───────────────────●
 Trilha sonora        [ – ]  9,5  [ + ]      ──────────────────●─
 Visual               [ – ]  9,5  [ + ]      ──────────────────●─
 Duração percebida    [ – ]  8,0  [ + ]      ───────────────●────

 [ O que você achou?                                                      ]
 [                                                                        ]

 Prós  [ Exploração ×] [ Trilha sonora ×] [ + ]
 Contras  [ Começo lento ×] [ + ]

 Tempo para zerar [ 34 ] h   (da jogatina; pode editar)
 ☐ Contém spoilers

                                                    [ Salvar review ]
```

- Notas de 0 a 10 em passos de 0,5. Subnotas são opcionais ("—" quando vazias).
- Depois de salva, a aba mostra a review em modo leitura, com "Editar".
- Texto marcado como spoiler fica oculto em modo leitura até um clique.

---

## 4. Primeira configuração

Abre sozinha na primeira execução. Cada passo pode ser pulado e refeito depois em Ajustes › Fontes.

```
┌──────────────────────────────────────────────────────────────┐
│ Configuração inicial                          Passo 2 de 4   │
│                                                              │
│ Catálogo de jogos (IGDB)                                     │
│                                                              │
│ A busca de jogos usa a IGDB, que pede uma credencial         │
│ gratuita da Twitch. Leva uns 3 minutos:                      │
│                                                              │
│ 1. Entre em dev.twitch.tv/console com sua conta Twitch.      │
│ 2. Clique em "Registrar seu aplicativo".                     │
│ 3. Nome: qualquer um. URL de redirecionamento:               │
│    http://localhost. Categoria: Application Integration.     │
│ 4. Abra o aplicativo criado e copie o Client ID.             │
│ 5. Clique em "Novo segredo" e copie o Client Secret.         │
│                                                              │
│ Client ID      [                                          ]  │
│ Client Secret  [                                          ]  │
│                                                              │
│ [ Testar conexão ]   Conectado. 1 jogo encontrado no teste.  │
│                                                              │
│ As chaves ficam guardadas no cofre de senhas do seu sistema. │
│                                                              │
│ Pular por enquanto                    [ Voltar ]  [ Seguir ] │
└──────────────────────────────────────────────────────────────┘
```

Passos:

1. **Boas-vindas** — o que o app faz, que tudo fica neste computador, onde está a pasta de dados.
2. **IGDB** — como acima.
3. **Steam (opcional)** — chave da Web API e SteamID, com o passo a passo de onde achar cada um e
   o aviso de que o perfil precisa estar público. "Testar conexão" diz o que falhou, se falhar.
4. **Pronto** — "Importar minha biblioteca da Steam" (se configurada) ou "Adicionar meu primeiro
   jogo". Um link discreto leva às fontes opcionais (RAWG, RetroAchievements) em Ajustes.

O passo a passo exato de cada serviço será conferido na documentação oficial na hora de implementar.

---

## 5. Importar biblioteca Steam

```
 Importar da Steam

 128 jogos encontrados · 119 identificados · 9 para revisar

 Mostrar: (•) todos  ( ) para revisar  ( ) nunca jogados
 Selecionados: 119     Definir status dos selecionados: [ — ▾ ]

 ☑ ┌──┐ Hollow Knight            34h    Hollow Knight (2017)     [ Backlog ▾ ]
 ☑ ┌──┐ Hades                     0h    Hades (2020)             [ Backlog ▾ ]
 ☑ ┌──┐ DARK SOULS™: REMASTERED  61h    Dark Souls: Remastered   [ Jogando ▾ ]
 ☐ ┌──┐ Soundtrack Pack           0h    Não identificado · buscar
 ─ ┌──┐ Celeste                   4h    Já na biblioteca · só atualiza as horas

                                   [ Cancelar ]   [ Importar 119 jogos ]
```

- Colunas: nome na Steam, horas, jogo correspondente no catálogo (com "trocar"), status a aplicar.
- Status sugerido: _Jogando_ se jogado nas duas últimas semanas, senão _Backlog_. A Steam não diz
  se o jogo foi zerado, então isso fica para o usuário.
- Nada é gravado antes de "Importar". Depois, um resumo: importados, atualizados, ignorados.

---

## 6. Ajustes

Uma página com três seções, navegáveis por âncoras no topo: **Fontes · Dados · Aparência**.

### Fontes

```
 IGDB                 Conectada · testada há 2 dias            Testar  Editar
 Steam                Conectada · SteamID 7656…4821            Testar  Editar
 HowLongToBeat        Ativa · não precisa de chave · última consulta ok
 RAWG                 Não configurada · opcional               Configurar
 RetroAchievements    Não configurada · opcional               Configurar
```

Chaves nunca aparecem depois de salvas; só "salva" e a opção de trocar ou remover.

### Dados

```
 Pasta de dados
 C:\Users\ana\AppData\Roaming\GameBacklog                              Copiar

 Exportar
 ☐ Incluir caches (arquivo maior; não é necessário para restaurar)
 Chaves e senhas nunca entram no arquivo.
 [ Exportar tudo em JSON ]

 Importar
 [ Escolher arquivo… ]
   gamebacklog-export-2026-11-10.json · versão 1 · 42 jogos · 10/11/2026
   Modo: (•) Mesclar com o que já tenho   ( ) Substituir tudo
   Prévia: 12 jogos novos · 3 alterados · 27 iguais · nada removido   Ver lista
   [ Confirmar importação ]

 Backup automático
 ☑ Fazer um backup por dia
 Pasta        [ D:\Backups\GameBacklog                               ]
 Manter os    [ 7 ] mais recentes
 Último backup: hoje, 09:12                              [ Fazer backup agora ]
```

- "Substituir tudo" pede uma confirmação a mais e informa que um backup é feito antes.
- A pasta de backup é digitada (um app no navegador não consegue abrir o seletor de pastas do
  sistema); o servidor valida se existe e se dá para escrever nela.

### Aparência

```
 Tema      (•) Seguir o sistema   ( ) Claro   ( ) Escuro
 Idioma    (•) Português (Brasil)   ( ) English
```

---

## Rotas

| Rota            | Tela                                         |
| --------------- | -------------------------------------------- |
| `/`             | Biblioteca (filtros e busca na query string) |
| `/games/:id`    | Página do jogo (`?tab=` guarda a aba)        |
| `/setup`        | Primeira configuração                        |
| `/import/steam` | Importar biblioteca Steam                    |
| `/settings`     | Ajustes                                      |

"Adicionar jogo" é um diálogo, não uma rota.

## Interpretações que fiz do escopo

1. **"Onde estou?" sem IA** = texto livre salvo + escolha manual do último marco entre as
   conquistas de história. O mapa de capítulos editável fica para a Fase 2, como no plano.
2. **Adicionar à mão** (título, plataforma, ano) entra como saída para quem pular a IGDB.
3. **Conquistas nesta fase são só as da Steam.** Checklist manual para PSN/Xbox fica para depois.
4. **RAWG e RetroAchievements** aparecem em Ajustes como "opcional", mas só passam a ser usadas na
   Fase 4.
