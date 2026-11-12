import { expect, test, type Page } from '@playwright/test';

/**
 * Main flows of the library, through the real interface in Portuguese: add a game, open it
 * from its cover, change its status, filter, export and import.
 *
 * No catalog credentials exist in the test environment, so games are added by hand — the same
 * path a user takes when they skip the IGDB setup.
 */

const unique = (name: string) => `${name} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;

test.beforeEach(async ({ request }) => {
  // Skip the first-run guide, which would otherwise take over the home page.
  await request.post('/api/app/setup-completed');
});

async function addGameByHand(page: Page, status: string, title: string, platform: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar jogo', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Adicionar jogo' });
  await dialog.getByRole('radio', { name: status, exact: true }).check();
  await dialog.getByRole('button', { name: 'Adicionar à mão' }).click();
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Plataforma').fill(platform);
  await dialog.getByLabel('Ano de lançamento').fill('2019');
  await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await dialog.getByRole('link', { name: 'Adicionado · abrir' }).click();

  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

/** A game's card in the cover grid (the sidebar lists the same games as links). */
const card = (page: Page, title: string) =>
  page
    .locator('#library')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: title }) });

test('adds a game with the status chosen in the dialog and opens it from its cover', async ({
  page,
}) => {
  const title = unique('Jogo de Teste');
  await addGameByHand(page, 'Quero jogar', title, 'Nintendo Switch');

  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('backlog');
  await expect(page.getByLabel('Plataforma')).toHaveValue('Nintendo Switch');
  await expect(page.getByRole('combobox', { name: 'Jogatina', exact: true })).toContainText(
    '1 · Primeira',
  );

  await page.getByRole('link', { name: '← Biblioteca' }).click();
  await expect(card(page, title)).toContainText('Quero jogar');
  await expect(card(page, title)).toContainText('Switch');

  // The cover and the name are one link to the game's screen.
  await card(page, title).getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(/\/games\//);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // "Add game" starts on the status being looked at.
  await page.goto('/?status=wishlist');
  await page.getByRole('button', { name: 'Adicionar jogo', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Adicionar jogo' }).getByRole('radio', { name: 'Wishlist' }),
  ).toBeChecked();
});

test('changes the status of a game and finds it under the new filter and tab', async ({ page }) => {
  const title = unique('Jogo Zerado');
  await addGameByHand(page, 'Jogando', title, 'PC');
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('playing');

  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('completed');
  // The run in progress follows the game's status.
  await expect(page.getByRole('combobox', { name: 'Status da jogatina' })).toHaveValue('completed');

  await page.getByRole('link', { name: '← Biblioteca' }).click();
  await expect(card(page, title)).toContainText('Zerado');

  await page.getByRole('button', { name: /^Zerados \d+$/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Zerados' })).toBeVisible();
  await expect(card(page, title)).toBeVisible();

  // The "Jogando agora" tab is the same filter as the "Jogando" pill.
  const other = unique('Jogo em Andamento');
  await addGameByHand(page, 'Jogando', other, 'PC');
  await page.getByRole('link', { name: 'Jogando agora', exact: true }).click();
  await expect(page).toHaveURL(/status=playing/);
  await expect(page.getByRole('button', { name: /^Jogando \d+$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card(page, other)).toBeVisible();
  await expect(card(page, title)).toHaveCount(0);
});

test('continue playing opens the hints and the 100% guide of the game', async ({ page }) => {
  await page.goto('/');
  const continuing = page.getByRole('region', { name: 'Continue jogando' });
  await expect(continuing.getByRole('listitem').first()).toBeVisible();

  await continuing.getByRole('link', { name: 'Dicas sem spoiler' }).first().click();
  await expect(page).toHaveURL(/\/games\/.+tab=hints/);
  await expect(page.getByRole('button', { name: 'Dicas', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goBack();
  await continuing.getByRole('link', { name: 'Guia 100% / platina' }).first().click();
  await expect(page).toHaveURL(/\/games\/.+tab=achievements/);
  await expect(page.getByRole('button', { name: '100% / Conquistas' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('searches, filters by platform and genre, switches to the list and hides the sidebar', async ({
  page,
}) => {
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Filtros e lista de jogos' });
  const grid = page.locator('#library');

  await sidebar.getByLabel('Buscar na biblioteca').fill('silksong');
  await expect(grid.getByRole('heading', { level: 3 })).toHaveText(['Hollow Knight: Silksong']);
  await expect(
    grid.getByRole('button', { name: 'Remover filtro: Busca: “silksong”' }),
  ).toBeVisible();
  await grid.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(sidebar.getByLabel('Buscar na biblioteca')).toHaveValue('');

  // Hollow Knight is played on PC: the Nintendo filter leaves it out.
  await sidebar.getByRole('checkbox', { name: 'Nintendo' }).click();
  await expect(sidebar.getByRole('checkbox', { name: 'Nintendo' })).toBeChecked();
  await expect(page).toHaveURL(/platform=nintendo/);
  await expect(grid.getByRole('listitem').first()).toBeVisible();
  await expect(card(page, 'Hollow Knight')).toHaveCount(0); // nor Silksong
  await sidebar.getByRole('checkbox', { name: 'Nintendo' }).click();
  await expect(sidebar.getByRole('checkbox', { name: 'Nintendo' })).not.toBeChecked();
  await expect(card(page, 'Hollow Knight')).toHaveCount(2); // and Silksong

  // Platform and genre combine.
  await sidebar.getByRole('checkbox', { name: 'PC / Steam' }).click();
  await expect(sidebar.getByRole('checkbox', { name: 'PC / Steam' })).toBeChecked();
  const firstGenre = sidebar
    .getByRole('group', { name: 'Gênero' })
    .getByRole('button', { pressed: false })
    .first();
  const genre = (await firstGenre.textContent()) ?? '';
  await firstGenre.click();
  await expect(grid.getByRole('button', { name: `Remover filtro: ${genre}` })).toBeVisible();
  await expect(grid.getByRole('button', { name: 'Remover filtro: PC / Steam' })).toBeVisible();
  await expect(grid.getByRole('listitem').first()).toBeVisible();

  await grid.getByRole('button', { name: 'Ver em lista' }).click();
  await expect(grid.getByRole('table')).toBeVisible();
  await grid.getByRole('button', { name: 'Ver em grade de capas' }).click();
  await expect(grid.getByRole('table')).toHaveCount(0);

  await page.getByRole('button', { name: 'Mostrar ou ocultar a lista lateral' }).click();
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'Mostrar ou ocultar a lista lateral' }).click();
  await expect(sidebar).toBeVisible();

  // The game list of the sidebar opens a game too.
  const playingNow = sidebar.getByRole('region', { name: /^Jogando agora/ });
  const first = playingNow.getByRole('link').first();
  const name = ((await first.textContent()) ?? '').replace(/\s*\(.*\)$/, '');
  await first.click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
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

  // Remove the game, from the options menu of its card.
  await page.goto('/?status=wishlist');
  page.once('dialog', (dialog) => void dialog.accept());
  await card(page, title).getByLabel(`Opções de ${title}`).click();
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
  await page.getByRole('link', { name: 'Wishlist', exact: true }).click();
  await expect(card(page, title)).toContainText('Wishlist');
  await expect(card(page, title)).toContainText('PS5');
  await card(page, title).getByRole('link', { name: title }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByText('Vale cada minuto.')).toBeVisible();
  await expect(page.getByText('8,5').first()).toBeVisible();
});
