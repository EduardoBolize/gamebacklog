import { expect, test, type Page } from '@playwright/test';

/**
 * Main flows of Phase 1, through the real interface in Portuguese:
 * add a game, change its status, export and import.
 *
 * No catalog credentials exist in the test environment, so games are added by hand — the same
 * path a user takes when they skip the IGDB setup.
 */

const unique = (name: string) => `${name} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;

test.beforeEach(async ({ request }) => {
  // Skip the first-run guide, which would otherwise take over the home page.
  await request.post('/api/app/setup-completed');
});

async function addGameByHand(page: Page, button: string, title: string, platform: string) {
  await page.goto('/');
  await page.getByRole('button', { name: button, exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Adicionar jogo' });
  await dialog.getByRole('button', { name: 'Adicionar à mão' }).click();
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Plataforma').fill(platform);
  await dialog.getByLabel('Ano de lançamento').fill('2019');
  await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await dialog.getByRole('link', { name: 'Adicionado · abrir' }).click();

  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title }) });

test('adds a game with the status of the button that opened the dialog', async ({ page }) => {
  const title = unique('Jogo de Teste');
  await addGameByHand(page, 'Vou jogar', title, 'Nintendo Switch');

  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('backlog');
  await expect(page.getByLabel('Plataforma')).toHaveValue('Nintendo Switch');
  await expect(page.getByRole('combobox', { name: 'Jogatina', exact: true })).toContainText(
    '1 · Primeira',
  );

  await page.getByRole('link', { name: '← Biblioteca' }).click();
  await expect(card(page, title)).toContainText('Backlog · Nintendo Switch');
});

test('changes the status of a game and finds it under the new filter', async ({ page }) => {
  const title = unique('Jogo Zerado');
  await addGameByHand(page, 'Estou jogando', title, 'PC');
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('playing');

  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('completed');
  // The run in progress follows the game's status.
  await expect(page.getByRole('combobox', { name: 'Status da jogatina' })).toHaveValue('completed');

  await page.getByRole('link', { name: '← Biblioteca' }).click();
  await expect(card(page, title)).toContainText('Zerado · PC');

  await page.getByRole('button', { name: /^Zerados \d+$/ }).click();
  await expect(card(page, title)).toBeVisible();

  // Another game keeps the "Jogando" filter on screen (filters with no games are hidden).
  const other = unique('Jogo em Andamento');
  await addGameByHand(page, 'Estou jogando', other, 'PC');
  await page.getByRole('link', { name: '← Biblioteca' }).click();
  await page.getByRole('button', { name: /^Jogando \d+$/ }).click();
  await expect(card(page, other)).toBeVisible();
  await expect(card(page, title)).toHaveCount(0);
});

test('exports the library, loses a game and gets it back by importing', async ({
  page,
}, testInfo) => {
  const title = unique('Jogo Exportado');
  await addGameByHand(page, 'Wishlist', title, 'PlayStation 5');

  // A review, to check that more than the game itself survives the trip.
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Escrever review' }).click();
  await page.getByRole('spinbutton', { name: 'Nota geral' }).fill('8.5');
  await page.getByLabel('O que você achou?').fill('Vale cada minuto.');
  await page.getByRole('button', { name: 'Salvar review' }).click();
  await expect(page.getByText('Vale cada minuto.')).toBeVisible();

  // Export.
  await page.goto('/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar tudo em JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^gamebacklog-export-\d{4}-\d{2}-\d{2}\.json$/);
  const exportFile = testInfo.outputPath('export.json');
  await download.saveAs(exportFile);

  // Remove the game.
  await page.goto('/');
  page.once('dialog', (dialog) => void dialog.accept());
  await card(page, title).getByText('⋯').click();
  await card(page, title).getByRole('button', { name: 'Remover da biblioteca' }).click();
  await expect(card(page, title)).toHaveCount(0);

  // Import, replacing everything with the file.
  await page.goto('/settings');
  await page.getByLabel('Arquivo de exportação').setInputFiles(exportFile);
  await page.getByLabel('Substituir tudo').check();
  await expect(page.getByText(/Prévia:.*1 novos/)).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByText(/Importação concluída/)).toBeVisible();
  await expect(page.getByText(/Cópia de segurança gravada em/)).toBeVisible();

  // The game is back, with its status, platform and review.
  await page.goto('/');
  await expect(card(page, title)).toContainText('Wishlist · PlayStation 5');
  await card(page, title).getByRole('link', { name: title }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByText('Vale cada minuto.')).toBeVisible();
  await expect(page.getByText('8,5').first()).toBeVisible();
});
