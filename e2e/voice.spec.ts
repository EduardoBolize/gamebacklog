import { expect, test, type Page } from '@playwright/test';

/**
 * Dictation: the microphone beside the fields where the user describes things in their own
 * words. The browser's recognition is replaced by a stand-in that "hears" a fixed sentence, so
 * the test needs no microphone, no network and no speech model.
 */

test.beforeEach(async ({ page, request }) => {
  await request.post('/api/app/setup-completed');
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (globalThis as unknown as { heardLang: string }).heardLang = this.lang;
      }
      stop() {
        const result = Object.assign([{ transcript: 'estou na igreja e travei no puzzle' }], {
          isFinal: true,
        });
        this.onresult?.({ resultIndex: 0, results: [result] });
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.assign(globalThis, { SpeechRecognition: FakeRecognition });
  });
});

/** The hint field only shows with an AI: the stand-in model of the e2e setup. */
async function connectFakeAi(page: Page) {
  await page.goto('/settings');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Ollama (local)' }) });
  await row.getByRole('button', { name: 'Configurar' }).click();
  await row.getByLabel('Endereço do servidor').fill('http://127.0.0.1:3878/v1');
  await row.getByRole('button', { name: 'Listar modelos' }).click();
  await row.getByLabel('Modelo').fill('fake-model');
  await row.getByRole('button', { name: 'Salvar' }).click();
  await expect(row.getByText('Salvo')).toBeVisible();
  await row.getByRole('button', { name: 'Testar conexão' }).click();
  await expect(row.getByText('Conectada: a IA respondeu.')).toBeVisible();
  // An earlier test may have left it in use already.
  const use = row.getByRole('button', { name: 'Usar esta' });
  await expect(row.getByText('Em uso').or(use)).toBeVisible();
  if (await use.isVisible()) await use.click();
  await expect(row.getByText('Em uso')).toBeVisible();
}

test('dictates into "where am I", the hint field and the diary', async ({ page, request }) => {
  const title = `Jogo Falado ${Date.now()}`;
  const added = await request.post('/api/library', {
    data: { status: 'playing', game: { kind: 'manual', title } },
  });
  const { libraryEntryId } = (await added.json()) as { libraryEntryId: string };
  await request.put(`/api/library/${libraryEntryId}/wiki`, { data: { wikiUrl: null } });
  await connectFakeAi(page);

  await page.goto(`/games/${libraryEntryId}`);
  const whereAmI = page.getByRole('textbox', { name: 'Onde estou?' });
  await whereAmI.fill('Capítulo 4.');
  await page.getByRole('button', { name: 'Falar em vez de escrever: Onde estou?' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ouvindo' })).toBeVisible();
  await page.getByRole('button', { name: 'Parar e usar o que eu disse: Onde estou?' }).click();
  // Added to what was typed, never sent on its own.
  await expect(whereAmI).toHaveValue('Capítulo 4. estou na igreja e travei no puzzle');
  expect(
    await page.evaluate(() => (globalThis as unknown as { heardLang: string }).heardLang),
  ).toBe('pt-BR');

  await page.getByRole('button', { name: 'Dicas', exact: true }).click();
  const stuckOn = page.getByRole('textbox', { name: /Onde travei/ });
  await page.getByRole('button', { name: /^Falar em vez de escrever: Onde travei/ }).click();
  await page.getByRole('button', { name: /^Parar e usar o que eu disse: Onde travei/ }).click();
  await expect(stuckOn).toHaveValue('estou na igreja e travei no puzzle');

  await page.getByRole('button', { name: 'Diário', exact: true }).click();
  await page.getByRole('button', { name: 'Registrar sessão' }).click();
  await page
    .getByRole('button', { name: /^Falar em vez de escrever: / })
    .last()
    .click();
  await page.getByRole('button', { name: /^Parar e usar o que eu disse: / }).click();
  await expect(page.getByRole('textbox', { name: 'Nota', exact: true })).toHaveValue(
    'estou na igreja e travei no puzzle',
  );
});

test('lets the user keep the audio on the PC from Settings', async ({ page }) => {
  await page.goto('/settings#voice');
  const local = page.getByRole('radio', { name: /^Local \(Whisper\)/ });
  await local.check();
  await page.reload();
  await expect(local).toBeChecked();
  await page.getByRole('radio', { name: /^Automático/ }).check();
});
