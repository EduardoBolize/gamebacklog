import { expect, test } from '@playwright/test';

/**
 * Phase 4: the statistics page, on the example library the test server is seeded with, and
 * the import pages of the console accounts when nothing is connected.
 */

test.beforeEach(async ({ request }) => {
  await request.post('/api/app/setup-completed');
});

test('shows the statistics of the library', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Estatísticas' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Estatísticas' })).toBeVisible();

  // Headline numbers.
  const tile = (label: string) =>
    page.locator('div', { has: page.getByText(label, { exact: true }) }).last();
  await expect(tile('Horas jogadas')).toContainText(/\d+h/);
  await expect(tile('Taxa de conclusão')).toContainText('%');
  await expect(tile('Tamanho do backlog')).toContainText(/\d+h/);

  // Breakdowns: every bar carries its value as text.
  const platforms = page.locator('section', {
    has: page.getByRole('heading', { name: 'Horas por plataforma' }),
  });
  await expect(platforms.getByRole('listitem').first()).toContainText('PC');
  await expect(platforms.getByRole('listitem').first()).toContainText(/\d+h · \d+ jogos/);

  const games = page.locator('section', {
    has: page.getByRole('heading', { name: 'Jogos com mais horas' }),
  });
  await expect(games.getByRole('link', { name: 'Elden Ring' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Média das suas notas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Diário de sessões' })).toBeVisible();
  await expect(page.getByText('Tempo por mês, últimos 12 meses')).toBeVisible();
});

test('explains how to connect a console before importing from it', async ({ page }) => {
  for (const [path, name] of [
    ['/import/psn', 'PlayStation'],
    ['/import/xbox', 'Xbox'],
  ] as const) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { level: 1, name: `Importar de ${name}` }),
    ).toBeVisible();
    await expect(
      page.getByText(`Conecte ${name} em Ajustes › Fontes para importar sua biblioteca.`),
    ).toBeVisible();
  }

  // The settings screen says plainly what each connection involves.
  await page.goto('/settings');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'PlayStation', exact: true }) });
  await row.getByRole('button', { name: 'Configurar' }).click();
  await expect(row.getByText(/caminho não oficial, fora dos termos da Sony/)).toBeVisible();
  await expect(row.getByLabel('Token NPSSO (64 caracteres)')).toBeVisible();
});
