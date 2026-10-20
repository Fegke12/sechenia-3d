import { type ConsoleMessage, type Page, expect, test } from '@playwright/test';

type V3 = [number, number, number];

/** Критические ошибки консоли (сетевые ошибки загрузки шрифтов в изолированной среде не считаются). */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_|fonts\.g/.test(m.text()))
      errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function open(page: Page, hash = '') {
  await page.goto('/' + hash);
  await page.waitForFunction(() => !!window.__scene && !!window.__store);
  await page.waitForTimeout(300);
}

/** Экранные координаты точки модели (координаты ядра) относительно страницы. */
async function screenOf(page: Page, p: V3) {
  const box = (await page.getByTestId('scene-canvas').boundingBox())!;
  const s = await page.evaluate((v) => window.__scene!.project(v), p);
  return { x: box.x + s.x, y: box.y + s.y };
}

async function clickModel(page: Page, p: V3) {
  const s = await screenOf(page, p);
  await page.mouse.move(s.x, s.y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(120);
}

const pointsState = (page: Page) =>
  page.evaluate(() => window.__store!.getState().points.map((p) => ({ label: p.label, spec: p.spec })));

test.describe('Сечения 3D — пользовательские сценарии', () => {
  test('1. главная страница открывается без ошибок', async ({ page }) => {
    const errors = watchConsole(page);
    await open(page);
    await expect(page).toHaveTitle('Сечения 3D');
    await expect(page.getByText('Сечения 3D').first()).toBeVisible();
    await expect(page.getByTestId('scene-canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('2–3. выбор куба и отображение в 3D-сцене', async ({ page }) => {
    const errors = watchConsole(page);
    await open(page);
    await page.getByTestId('kind-select').selectOption('pyramid');
    await page.getByTestId('kind-select').selectOption('cube');
    await expect(page.getByTestId('poly-title')).toContainText('Куб · В 8, Р 12, Г 6');
    // Холст действительно отрисован: на снимке много разных цветов.
    const colors = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=scene-canvas]') as HTMLCanvasElement;
      const t = document.createElement('canvas');
      t.width = c.width;
      t.height = c.height;
      const ctx = t.getContext('2d')!;
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, t.width, t.height).data;
      const set = new Set<number>();
      for (let i = 0; i < d.length; i += 4 * 97)
        if (d[i + 3] > 0) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return set.size;
    });
    expect(colors).toBeGreaterThan(20);
    // Подписи вершин куба на месте.
    for (const l of ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'])
      await expect(page.locator('.lbl-vertex', { hasText: new RegExp(`^${l}$`) })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('4. вращение и масштабирование модели', async ({ page }) => {
    await open(page);
    const before = await page.evaluate(() => window.__scene!.cameraState().position);
    const box = (await page.getByTestId('scene-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__scene!.cameraState().position);
    expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeGreaterThan(0.5);
    // Вращение мышью не добавляет точек (сечение примера сохраняется).
    expect((await pointsState(page)).length).toBe(3);
    const r0 = Math.hypot(...after);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(400);
    const r1 = Math.hypot(...(await page.evaluate(() => window.__scene!.cameraState().position)));
    expect(r1).not.toBeCloseTo(r0, 2);
    await page.getByRole('button', { name: 'Сверху' }).click();
    await page.waitForTimeout(600);
    const top = await page.evaluate(() => window.__scene!.cameraState().position);
    expect(top[1]).toBeGreaterThan(Math.abs(top[0]) * 10);
  });

  test('5–8. выбор трёх точек на модели, сечение, школьное решение, подсветка шагов', async ({ page }) => {
    const errors = watchConsole(page);
    await open(page);
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await expect(page.getByTestId('points-count')).toHaveText('0/3');
    // Куб с ребром 4: A(0,0,0), B(4,0,0), C(4,4,0), D(0,4,0), A₁ = A + (0,0,4) …
    await clickModel(page, [2, 0, 0]); // середина AB
    await expect(page.getByTestId('vp-status')).toContainText('ещё 2');
    await clickModel(page, [4, 4, 2]); // середина CC₁
    await clickModel(page, [0, 2, 4]); // середина A₁D₁
    const pts = await pointsState(page);
    expect(pts.map((p) => p.label)).toEqual(['M', 'N', 'K']);
    for (const p of pts) expect(p.spec).toMatchObject({ kind: 'edge', t: 0.5 });
    // 6. Правильный шестиугольник со стороной 2√2: S = (3√3/2)·8 ≈ 20.7846
    await expect(page.getByTestId('result-type')).toHaveText('шестиугольник');
    await expect(page.getByTestId('result-area')).toHaveText('20.7846');
    await expect(page.getByTestId('trusted')).toBeVisible();
    await expect(page.getByText('по вычислениям: правильный шестиугольник')).toBeVisible();
    // 7. Решение
    await expect(page.locator('[data-testid^=step-]').first()).toBeVisible();
    const nSteps = await page.locator('.sol-item').count();
    expect(nSteps).toBeGreaterThan(6);
    // 8. Переключение шагов меняет подсветку
    await page.getByTestId('next-step').click();
    await page.getByTestId('next-step').click();
    await expect(page.getByTestId('step-counter')).toHaveText(`2 / ${nSteps}`);
    const s2 = await page.evaluate(() => window.__scene!.debugSummary());
    await page.getByTestId('next-step').click();
    await page.getByTestId('next-step').click();
    const s4 = await page.evaluate(() => window.__scene!.debugSummary());
    expect(s4.constructionLines).toBeGreaterThan(s2.constructionLines);
    expect(s4.currentLines).toBeGreaterThan(0);
    await expect(page.getByTestId('step-detail')).toContainText('Обоснование');
    // На последнем шаге видно всё сечение.
    await page.getByTestId(`step-${nSteps - 1}`).click();
    expect((await page.evaluate(() => window.__scene!.debugSummary())).sectionFill).toBe(1);
    expect(errors).toEqual([]);
  });

  test('9. удаление точки и перестроение', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Удалить точку N' }).click();
    await expect(page.getByTestId('points-count')).toHaveText('2/3');
    await expect(page.getByTestId('vp-status')).toContainText('ещё 1');
    await expect(page.getByTestId('result')).toHaveCount(0);
    await clickModel(page, [4, 4, 2]); // середина CC₁
    await expect(page.getByTestId('points-count')).toHaveText('3/3');
    await expect(page.getByTestId('trusted')).toBeVisible();
  });

  test('10. точка через отношение отрезков в школьной записи', async ({ page }) => {
    await open(page);
    await page.getByTestId('tab-conditions').click();
    await page
      .getByTestId('conditions-text')
      .fill('M ∈ AB, AM : MB = 2 : 1\nN — середина CC₁\nK ∈ A₁D₁, A₁K : KD₁ = 1 : 3');
    await page.getByTestId('apply-conditions').click();
    await expect(page.getByTestId('point-M')).toContainText('(2.667; 0; 0)');
    await expect(page.getByTestId('point-K')).toContainText('(0; 1; 4)');
    await expect(page.getByTestId('trusted')).toBeVisible();
    // Перемещение точки ползунком пересчитывает сечение.
    const area0 = await page.getByTestId('result-area').textContent();
    await page.getByRole('slider', { name: 'Положение точки M на ребре' }).fill('0.3');
    await expect(page.getByTestId('result-area')).not.toHaveText(area0!);
    await expect(page.getByTestId('trusted')).toBeVisible();
  });

  test('11. некорректный ввод вызывает понятную ошибку', async ({ page }) => {
    await open(page);
    await page.getByTestId('tab-conditions').click();
    await page.getByTestId('conditions-text').fill('M ∈ AC, AM : MC = 1 : 1');
    await page.getByTestId('apply-conditions').click();
    await expect(page.getByTestId('conditions-errors')).toContainText('AC — не ребро многогранника');
    // Коллинеарные точки
    await page
      .getByTestId('conditions-text')
      .fill('M ∈ AB, AM : MB = 1 : 3\nN — середина AB\nK ∈ AB, AK : KB = 3 : 1');
    await page.getByTestId('apply-conditions').click();
    await expect(page.getByTestId('plane-error')).toContainText('лежат на одной прямой');
    await expect(page.getByTestId('vp-status')).toHaveClass(/error/);
    // Четвёртая точка не добавляется
    await page
      .getByTestId('conditions-text')
      .fill('M — середина AB\nN — середина BC\nK — середина CC₁\nL — середина DD₁');
    await page.getByTestId('apply-conditions').click();
    await expect(page.getByTestId('conditions-errors')).toContainText('ровно тремя');
  });

  test('12. смена многогранника не ломает интерфейс', async ({ page }) => {
    const errors = watchConsole(page);
    await open(page);
    for (const kind of [
      'pyramid',
      'prism',
      'tetrahedron',
      'parallelepiped',
      'octahedron',
      'dodecahedron',
      'icosahedron',
      'cube',
    ]) {
      await page.getByTestId('kind-select').selectOption(kind);
      await expect(page.getByTestId('points-count')).toHaveText('0/3');
    }
    await page.getByTestId('kind-select').selectOption('prism');
    await page.locator('#param-n').selectOption('5');
    await expect(page.getByTestId('poly-title')).toContainText('пятиугольная');
    // Пример из меню
    await page.getByTestId('examples-btn').click();
    await page.getByRole('menuitem', { name: /Пирамида SABCD: метод следов/ }).click();
    await expect(page.getByTestId('result-type')).toHaveText('пятиугольник');
    await expect(page.getByTestId('trusted')).toBeVisible();
    // Случайная задача
    await page.getByTestId('random-btn').click();
    await expect(page.getByTestId('trusted')).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const vp of [
    { width: 1600, height: 950 },
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ])
    test(`13. панели на экране ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await open(page);
      const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
      const left = await box('.left');
      const center = await box('.center');
      const bottom = await box('.bottom');
      expect(left.width).toBeGreaterThan(250);
      expect(center.width).toBeGreaterThan(500);
      expect(center.height).toBeGreaterThan(250);
      expect(left.x + left.width).toBeLessThanOrEqual(center.x + 1);
      expect(center.y + center.height).toBeLessThanOrEqual(bottom.y + 1);
      if (vp.width > 1180) {
        const right = await box('.right');
        expect(center.x + center.width).toBeLessThanOrEqual(right.x + 1);
        expect(right.x + right.width).toBeLessThanOrEqual(vp.width + 1);
      }
      // Нет горизонтальной прокрутки страницы
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

  test('14. режим обучения: урок, демонстрация, тест и упражнение с проверкой', async ({ page }) => {
    const errors = watchConsole(page);
    await open(page);
    await page.getByTestId('mode-learn').click();
    await page.getByRole('button', { name: /Многогранник и его элементы/ }).click();
    await expect(page.getByTestId('lesson-theory')).toContainText('формула Эйлера');
    await page.getByTestId('quiz-0').click();
    await expect(page.getByTestId('quiz-feedback')).toContainText('Неверно');
    await page.getByRole('button', { name: 'Попробовать ещё раз' }).click();
    await page.getByTestId('quiz-1').click();
    await expect(page.getByTestId('quiz-feedback')).toContainText('Верно');
    // Урок с отметкой вершин
    await page.getByRole('button', { name: /Пересечение плоскости с ребром/ }).click();
    await page.getByTestId('lesson-demo').click();
    await expect(page.getByTestId('step-counter')).toContainText('1 /');
    await page.getByTestId('lesson-start-mark').click();
    await expect(page.getByTestId('step-detail')).toHaveCount(0);
    // Сечение плоскостью B₁MN куба: треугольник B₁MN — отмечаем две верные вершины и одну неверную.
    await clickModel(page, [2, 0, 0]); // M — середина AB
    await clickModel(page, [4, 2, 0]); // N — середина BC
    await clickModel(page, [0, 4, 2]); // середина DD₁ — неверно
    await page.getByTestId('check-marks').click();
    await expect(page.getByTestId('marks-result')).toContainText('Найдено 2 из 3');
    await expect(page.getByTestId('marks-result')).toContainText('по одну сторону');
    expect(errors).toEqual([]);
  });

  test('проверка себя и режим «сначала сам»', async ({ page }) => {
    await open(page);
    await page.getByTestId('self-mode').check();
    await expect(page.getByTestId('reveal')).toHaveCount(0); // первый шаг открыт
    await page.getByTestId('next-step').click();
    await expect(page.getByTestId('reveal')).toBeVisible();
    await expect(page.getByTestId('step-detail')).toContainText('Попробуйте сами');
    await page.getByTestId('reveal').click();
    await expect(page.getByTestId('step-detail')).toContainText('Обоснование');
    // Скрыть решение
    await page.getByTestId('hide-solution').check();
    await expect(page.getByTestId('solution-panel')).toContainText('Решение скрыто');
    await expect(page.getByTestId('result')).toHaveCount(0);
    await page.getByTestId('hide-solution').uncheck();
    // Проверка себя: отмечаем все 5 вершин пятиугольника примера (куб, M — сер. AB, N — сер. BC, K ∈ DD₁ 2:1)
    await page.getByTestId('start-selfcheck').click();
    for (const p of [
      [2, 0, 0],
      [4, 2, 0],
      [0, 4, 8 / 3],
      [4, 4, 8 / 9],
      [0, 0, 8 / 9],
    ] as V3[])
      await clickModel(page, p);
    await page.getByTestId('check-marks').click();
    await expect(page.getByTestId('marks-result')).toContainText('Верно! Все 5 вершин');
  });

  test('сохранение в URL и восстановление после перезагрузки', async ({ page }) => {
    await open(page);
    await page.getByTestId('tab-conditions').click();
    await page
      .getByTestId('conditions-text')
      .fill('M ∈ AB, AM : MB = 1 : 4\nN — середина CC₁\nK — центр грани A₁B₁C₁D₁');
    await page.getByTestId('apply-conditions').click();
    await page.waitForTimeout(500);
    const url = page.url();
    expect(url).toMatch(/#s=/);
    const area = await page.getByTestId('result-area').textContent();
    await page.goto('about:blank');
    await page.goto(url);
    await page.waitForFunction(() => !!window.__store);
    await expect(page.getByTestId('result-area')).toHaveText(area!);
    expect((await pointsState(page)).map((p) => p.label)).toEqual(['M', 'N', 'K']);
  });

  test('экспорт изображения и справка', async ({ page }) => {
    await open(page);
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Экспорт изображения' }).click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.png$/);
    await page.getByTestId('help-btn').click();
    await expect(page.getByRole('dialog', { name: 'Справка' })).toContainText('Как пользоваться');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
