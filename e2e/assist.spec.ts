import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Phase 2 through the real interface: connect an AI, say where you are, climb the hint ladder,
 * see the answer come from the cache the second time, and get the point-of-no-return warning.
 *
 * The AI is `e2e/fake-llm.mjs`, an OpenAI-compatible stand-in the app reaches exactly as it
 * would reach Ollama. The wiki is switched off for the test game so nothing leaves the machine.
 */

const FAKE_LLM = 'http://127.0.0.1:3878';
const unique = (name: string) => `${name} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;

test.beforeEach(async ({ request }) => {
  await request.post('/api/app/setup-completed');
});

async function createGame(request: APIRequestContext, title: string) {
  const added = await request.post('/api/library', {
    data: { status: 'playing', game: { kind: 'manual', title } },
  });
  const { libraryEntryId } = (await added.json()) as { libraryEntryId: string };
  // No wiki for this game: the test must not depend on the network.
  await request.put(`/api/library/${libraryEntryId}/wiki`, { data: { wikiUrl: null } });
  await request.put(`/api/library/${libraryEntryId}/map`, {
    data: {
      checkpoints: [
        {
          name: 'Kokiri Forest',
          aliases: ['Floresta Kokiri'],
          isPointOfNoReturn: false,
          bossName: null,
        },
        {
          name: 'Inside the Deku Tree',
          aliases: ['Árvore Deku'],
          isPointOfNoReturn: false,
          bossName: 'Queen Gohma',
        },
        {
          name: 'Temple of Time',
          aliases: ['Templo do Tempo'],
          isPointOfNoReturn: true,
          bossName: null,
        },
      ],
    },
  });
  return libraryEntryId;
}

const chatRequests = async (request: APIRequestContext) =>
  ((await (await request.get(`${FAKE_LLM}/requests`)).json()) as { chatRequests: number })
    .chatRequests;

async function connectFakeAi(page: Page) {
  await page.goto('/settings');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Ollama (local)' }) });
  await row.getByRole('button', { name: 'Configurar' }).click();
  await row.getByLabel('Endereço do servidor').fill(`${FAKE_LLM}/v1`);
  await row.getByRole('button', { name: 'Listar modelos' }).click();
  await row.getByLabel('Modelo').fill('fake-model');
  await row.getByRole('button', { name: 'Salvar' }).click();
  await expect(row.getByText('Salvo')).toBeVisible();

  await row.getByRole('button', { name: 'Testar conexão' }).click();
  await expect(row.getByText('Conectada: a IA respondeu.')).toBeVisible();
  await row.getByRole('button', { name: 'Usar esta' }).click();
  await expect(row.getByText('Em uso')).toBeVisible();
}

test('hints are locked until an AI is connected', async ({ page, request }) => {
  await request.put('/api/ai/settings', { data: { activeProviderId: null } });
  const entryId = await createGame(request, unique('Jogo sem IA'));

  await page.goto(`/games/${entryId}?tab=hints`);
  await expect(page.getByText('Conecte uma IA para liberar dicas em quatro níveis')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Conectar uma IA' })).toHaveAttribute(
    'href',
    '/settings#ai',
  );
});

test('connects an AI, places the player, climbs the hint ladder and reuses the cache', async ({
  page,
  request,
}) => {
  const title = unique('Ocarina de Teste');
  const entryId = await createGame(request, title);
  await connectFakeAi(page);

  // "Where am I?" in Portuguese: matched to the map locally, with no AI call.
  await page.goto(`/games/${entryId}`);
  const before = await chatRequests(request);
  await page.getByLabel('Onde estou?').fill('acabei de entrar na Árvore Deku');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Entendi: você está em Inside the Deku Tree.')).toBeVisible();
  await expect(page.getByText('Reconhecido sem usar IA.')).toBeVisible();
  expect(await chatRequests(request)).toBe(before);

  // The map shows where the player is and keeps what lies further ahead hidden.
  await expect(page.getByText('← você está aqui')).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Inside the Deku Tree' }).first(),
  ).toBeVisible();

  // The app offers boss tips on its own, without spending a request.
  await page
    .getByRole('button', { name: 'Quer dicas para Queen Gohma, o chefe desta área?' })
    .click();
  await expect(page.getByText('Você está em Inside the Deku Tree.')).toBeVisible();
  await expect(page.getByLabel('Um chefe')).toBeChecked();

  // Hint ladder: level 1, then level 2, each fetched only when asked.
  await page.getByLabel('Como avançar').check();
  await page.getByLabel(/Onde travei/).fill('a teia no chão');
  await page.getByRole('button', { name: 'Estou com dificuldade' }).click();
  await expect(page.getByText('Abra o nível anterior primeiro.').first()).toBeVisible();

  await page.getByRole('button', { name: 'Ver Nível 1 · empurrão' }).click();
  await expect(page.getByText('Dica de nível 1 para o teste.')).toBeVisible();
  await page.getByRole('button', { name: 'Ver Nível 2 · direção' }).click();
  await expect(page.getByText('Dica de nível 2 para o teste.')).toBeVisible();
  expect(await chatRequests(request)).toBe(before + 2);

  // The same request again comes from the cache: zero tokens, no new call to the AI.
  await page.reload();
  await page.getByLabel('Como avançar').check();
  await page.getByLabel(/Onde travei/).fill('a teia no chão');
  await page.getByRole('button', { name: 'Estou com dificuldade' }).click();
  await page.getByRole('button', { name: 'Ver Nível 1 · empurrão' }).click();
  await expect(page.getByText('Dica de nível 1 para o teste.')).toBeVisible();
  await expect(page.getByText('do cache · 0 tokens')).toBeVisible();
  expect(await chatRequests(request)).toBe(before + 2);

  // And the usage screen says so.
  await page.goto('/ai/usage');
  const firstRow = page.getByRole('row').nth(1);
  await expect(firstRow).toContainText('Dica');
  await expect(firstRow).toContainText(title);
  await expect(firstRow).toContainText('cache · 0 tokens');
});

test('warns before recording progress past a point of no return', async ({ page, request }) => {
  const entryId = await createGame(request, unique('Jogo com Ponto sem Volta'));
  await page.goto(`/games/${entryId}`);

  await page.getByLabel('Onde estou?').fill('cheguei no Templo do Tempo');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Ponto sem volta à frente' });
  await expect(dialog).toContainText('Ao chegar em "Temple of Time" você não poderá mais voltar');

  // Backing out records nothing.
  await dialog.getByRole('button', { name: 'Ainda não' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('← você está aqui')).toHaveCount(0);

  // Confirming does. The text is still in the field, since nothing was saved.
  await expect(page.getByLabel('Onde estou?')).toHaveValue('cheguei no Templo do Tempo');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Registrar mesmo assim' }).click();
  await expect(page.getByText('Entendi: você está em Temple of Time.')).toBeVisible();
  await expect(page.getByText('← você está aqui')).toBeVisible();
});
