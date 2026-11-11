import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Phase 3 through the real interface, on the example library the test server is seeded with:
 * the ranked backlog with its reasons, games worth resuming, the favourite genre, similar
 * games on a game's page — all with no AI — and then the optional one-line explanations.
 */

const FAKE_LLM = 'http://127.0.0.1:3878';

test.beforeEach(async ({ request }) => {
  await request.post('/api/app/setup-completed');
});

const item = (page: Page, title: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });

const chatRequests = async (request: APIRequestContext) =>
  ((await (await request.get(`${FAKE_LLM}/requests`)).json()) as { chatRequests: number })
    .chatRequests;

test('ranks the backlog and explains each position, with no AI connected', async ({
  page,
  request,
}) => {
  await request.put('/api/ai/settings', { data: { activeProviderId: null } });
  await page.goto('/');
  await page.getByRole('link', { name: 'Recomendações' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Recomendações' })).toBeVisible();

  // Loved soulslikes and metroidvanias come first; dropped strategy games sink.
  const backlog = page.locator('section', {
    has: page.getByRole('heading', { name: 'Do seu backlog' }),
  });
  await expect(backlog.getByRole('heading', { name: 'Lies of P' })).toBeVisible();
  const titles = await backlog.getByRole('heading', { level: 3 }).allTextContents();
  expect(titles.slice(0, 3)).toEqual(['Hollow Knight: Silksong', 'Lies of P', 'Blasphemous']);
  expect(titles.indexOf('Cities: Skylines')).toBeGreaterThan(titles.indexOf('Hades'));

  await expect(item(page, 'Lies of P')).toContainText(
    'soulslike: como em Elden Ring, Bloodborne e Dark Souls: Remastered',
  );
  await expect(item(page, 'Cities: Skylines')).toContainText('costuma não te agradar');

  // A paused game shows up as worth resuming, with how far the user got.
  const resume = page.locator('section', {
    has: page.getByRole('heading', { name: 'Vale retomar' }),
  });
  await expect(resume.getByRole('heading', { name: 'Celeste' })).toBeVisible();
  await expect(resume).toContainText('Você já jogou cerca de 50% da história');

  // The AI step is only an invitation.
  await expect(
    page.getByText('Conecte uma IA para liberar uma linha explicando cada recomendação.'),
  ).toBeVisible();

  // The profile behind the ranking can be inspected.
  await page.getByText('Seu perfil de gosto').click();
  await expect(page.getByText(/Baseado em \d+ jogos\./)).toBeVisible();
  await expect(page.getByText(/Evita: .*Strategy/)).toBeVisible();
});

test('shows the favourite genre and lets the user pick another', async ({ page }) => {
  await page.goto('/recommendations?tab=genre');
  const genre = page.getByRole('combobox', { name: 'Gênero' });
  await expect(genre).toHaveValue('Adventure');
  await expect(item(page, 'Hollow Knight: Silksong')).toBeVisible();
  // No catalog credentials in the test environment: discoveries are simply not offered.
  await expect(
    page.getByText('Configure a IGDB para ver também jogos que não estão na sua biblioteca.'),
  ).toBeVisible();

  await genre.selectOption('Role-playing (RPG)');
  await expect(item(page, 'Lies of P')).toBeVisible();
  await expect(item(page, 'Hollow Knight: Silksong')).toHaveCount(0);
});

test('lists similar games on the page of a game', async ({ page }) => {
  await page.goto('/games/seed-entry-hollow-knight');
  await page.getByRole('button', { name: 'Parecidos', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Parecidos com este jogo' })).toBeVisible();
  const silksong = item(page, 'Hollow Knight: Silksong');
  await expect(silksong).toContainText('Em comum: Hollow Knight');
  await expect(silksong).toContainText(/parecido \d+%/);
  // Finished games are not recommendations.
  await expect(item(page, 'Super Metroid')).toHaveCount(0);

  // No achievements stored for this game: the second list says what is missing.
  await expect(page.getByText('Este jogo ainda não tem conquistas guardadas.')).toBeVisible();
});

test('writes one line per game with a single AI request, then reuses the cache', async ({
  page,
  request,
}) => {
  await request.put('/api/ai/providers/ollama', {
    data: { baseUrl: `${FAKE_LLM}/v1`, model: 'fake-model' },
  });
  await request.put('/api/ai/settings', { data: { activeProviderId: 'ollama' } });

  await page.goto('/recommendations');
  const before = await chatRequests(request);
  await page.getByRole('button', { name: 'Explicar com IA' }).click();
  await expect(item(page, 'Hollow Knight: Silksong')).toContainText('Linha de teste 1.');
  await expect(item(page, 'Lies of P')).toContainText('Linha de teste 2.');
  expect(await chatRequests(request)).toBe(before + 1);

  // The lines survive a reload, and asking again costs nothing.
  await page.reload();
  await expect(item(page, 'Lies of P')).toContainText('Linha de teste 2.');
  await page.getByRole('button', { name: 'Explicar com IA' }).click();
  await expect(page.getByText('do cache · 0 tokens')).toBeVisible();
  expect(await chatRequests(request)).toBe(before + 1);

  await page.goto('/ai/usage');
  const firstRow = page.getByRole('row').nth(1);
  await expect(firstRow).toContainText('Explicação das recomendações');
  await expect(firstRow).toContainText('cache · 0 tokens');
});
