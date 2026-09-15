import { expect, test, type Page } from '@playwright/test'

/** 取 SVG 端点圆心的屏幕坐标（<g> 的 bbox 含文字，不能直接取 bbox 中心） */
async function endpointCenter(page: Page, side: 'A' | 'B', pin: string) {
  return page.$eval(
    `[data-testid="endpoint-${side}-${pin}"]`,
    (g) => {
      const ctm = (g as SVGGraphicsElement).getScreenCTM()
      const pt = new DOMPoint(0, 0).matrixTransform(ctm!)
      return { x: pt.x, y: pt.y }
    },
  )
}

async function dragBetween(page: Page, aPin: string, bPin: string) {
  const from = await endpointCenter(page, 'A', aPin)
  const to = await endpointCenter(page, 'B', bPin)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 })
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

async function fillExampleAndEnter(page: Page) {
  await page.goto('/')
  await page.getByTestId('load-example').click()
  await expect(page.getByTestId('enter-stage')).toBeEnabled()
  await page.getByTestId('enter-stage').click()
  await expect(page.getByTestId('expected-list')).toBeVisible()
}

async function wireCount(page: Page) {
  return page.locator('path.wire[data-wire-id]').count()
}

test.describe('录入阶段：录入约定的强制校验', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('两侧针位重复时，在对应针位旁反馈且禁止进入', async ({ page }) => {
    await page.getByTestId('pins-a').fill('A1\nA1\nA2')
    await page.getByTestId('pins-b').fill('B1\nB1')
    await page.getByTestId('target-A1').selectOption('B1')

    await expect(page.getByTestId('a-error-A1')).toContainText('重复')
    await expect(page.getByTestId('b-error-B1')).toContainText('重复')
    await expect(page.getByTestId('enter-stage')).toBeDisabled()
  })

  test('A 端未指定预期端时在该行旁反馈', async ({ page }) => {
    await page.getByTestId('pins-a').fill('A1\nA2')
    await page.getByTestId('pins-b').fill('B1\nB2')
    await page.getByTestId('target-A1').selectOption('B1')

    await expect(page.getByTestId('a-error-A2')).toContainText('尚未指定预期')
    await expect(page.getByTestId('enter-stage')).toBeDisabled()
  })

  test('预期端从 B 清单删除（预期端不存在）时在 A 行旁反馈', async ({ page }) => {
    await page.getByTestId('pins-a').fill('A1\nA2')
    await page.getByTestId('pins-b').fill('B1\nB2')
    await page.getByTestId('target-A1').selectOption('B1')
    await page.getByTestId('target-A2').selectOption('B2')
    await expect(page.getByTestId('enter-stage')).toBeEnabled()

    await page.getByTestId('pins-b').fill('B1')
    await expect(page.getByTestId('a-error-A2')).toContainText('不在 B 端针位清单中')
    await expect(page.getByTestId('enter-stage')).toBeDisabled()
  })

  test('两个 A 端指向同一 B 端时在两个 A 行旁反馈，并指出未覆盖的 B 针位', async ({
    page,
  }) => {
    await page.getByTestId('pins-a').fill('A1\nA2')
    await page.getByTestId('pins-b').fill('B1\nB2')
    await page.getByTestId('target-A1').selectOption('B2')
    await page.getByTestId('target-A2').selectOption('B2')

    await expect(page.getByTestId('a-error-A1')).toContainText('多个 A 端')
    await expect(page.getByTestId('a-error-A2')).toContainText('多个 A 端')
    await expect(page.getByTestId('b-error-B1')).toContainText('没有任何 A 端')
    await expect(page.getByTestId('enter-stage')).toBeDisabled()
  })
})

test.describe('连线阶段：鼠标拖拽链路', () => {
  test('正确线中性、错接线标红指出预期端；占用被拒绝且原线保留；删错线补接后通过', async ({
    page,
  }) => {
    // 示例预期：A1→B3, A2→B1, A3→B4, A4→B2
    await fillExampleAndEnter(page)

    // 一条正确线
    await dragBetween(page, 'A1', 'B3')
    const wireA1 = page.locator('[data-wire-id][data-a="A1"]')
    await expect(wireA1).toHaveAttribute('data-b', 'B3')
    await expect(wireA1).toHaveAttribute('data-verdict', 'correct')

    // 一条错接线：A2 拖到 B2（预期 B1）
    await dragBetween(page, 'A2', 'B2')
    const wireA2 = page.locator('[data-wire-id][data-a="A2"]')
    await expect(wireA2).toHaveAttribute('data-verdict', 'wrong')
    await expect(page.getByTestId('endpoint-expected-A-A2')).toContainText('应接 B1')
    await expect(page.getByTestId(`wire-label-${await wireA2.getAttribute('data-wire-id')}`)).toContainText(
      '预期 B1',
    )
    await expect(page.getByTestId('bundle-status')).toHaveAttribute('data-status', 'incomplete')

    // A 端第二次占用：把已占用的 A1 再拖向 B1，必须被拒绝并保留 A1-B3
    await dragBetween(page, 'A1', 'B1')
    await expect(page.getByTestId('endpoint-error-A-A1')).toContainText('已占用')
    expect(await wireCount(page)).toBe(2)
    await expect(page.locator('[data-wire-id][data-a="A1"]')).toHaveAttribute('data-b', 'B3')

    // B 端第二次占用：A3 拖向已被 A1 占用的 B3
    await dragBetween(page, 'A3', 'B3')
    await expect(page.getByTestId('endpoint-error-B-B3')).toContainText('已占用')
    expect(await wireCount(page)).toBe(2)

    // 再接一条正确线 A3-B4，并故意把 A4 错接到 B1，使全部端点占满且存在错接
    await dragBetween(page, 'A3', 'B4')
    await dragBetween(page, 'A4', 'B1')
    expect(await wireCount(page)).toBe(4)
    await expect(page.getByTestId('bundle-status')).toHaveAttribute(
      'data-status',
      'complete_with_errors',
    )
    await expect(page.getByTestId('wrong-list').locator('li')).toHaveText([
      /A2.*B2.*B1/,
      /A4.*B1.*B2/,
    ])
    await expect(page.getByTestId('bundle-pass')).toHaveCount(0)

    // 删除两条错线；两条正确线必须保留
    for (const a of ['A2', 'A4']) {
      const id = await page
        .locator(`[data-wire-id][data-a="${a}"]`)
        .getAttribute('data-wire-id')
      await page.getByTestId(`wire-delete-${id}`).click()
    }
    expect(await wireCount(page)).toBe(2)
    await expect(page.locator('[data-wire-id][data-a="A1"]')).toHaveAttribute('data-b', 'B3')
    await expect(page.locator('[data-wire-id][data-a="A3"]')).toHaveAttribute('data-b', 'B4')
    await expect(page.getByTestId('bundle-status')).toHaveAttribute('data-status', 'incomplete')

    // 直接补接为正确关系
    await dragBetween(page, 'A2', 'B1')
    await dragBetween(page, 'A4', 'B2')
    expect(await wireCount(page)).toBe(4)
    await expect(page.getByTestId('bundle-status')).toHaveAttribute('data-status', 'pass')
    await expect(page.getByTestId('bundle-pass')).toContainText('整束核验通过')
    await expect(page.locator('[data-wire-id][data-verdict="wrong"]')).toHaveCount(0)
  })
})

test.describe('连线阶段：键盘选择链路', () => {
  async function keyboardConnect(page: Page, aPin: string, bPin: string) {
    await page.getByTestId(`endpoint-A-${aPin}`).focus()
    await page.keyboard.press('Enter')
    await page.getByTestId(`endpoint-B-${bPin}`).focus()
    await page.keyboard.press('Enter')
  }

  test('Enter 选择两端建立连线；同侧选择被拒；占用被拒；Delete 删线后可键盘补接至通过', async ({
    page,
  }) => {
    await fillExampleAndEnter(page)

    await keyboardConnect(page, 'A1', 'B3')
    await expect(page.locator('[data-wire-id][data-a="A1"]')).toHaveAttribute(
      'data-verdict',
      'correct',
    )

    // 同侧（都在 A 端）选择必须被拒绝，原因在第二次选择的端点旁
    await page.getByTestId('endpoint-A-A2').focus()
    await page.keyboard.press('Enter')
    await page.getByTestId('endpoint-A-A3').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('endpoint-error-A-A3')).toContainText('同一侧')
    expect(await wireCount(page)).toBe(1)

    // 键盘重复占用被拒绝（A1 已连 B3），原线保留
    await keyboardConnect(page, 'A1', 'B1')
    await expect(page.getByTestId('endpoint-error-A-A1')).toContainText('已占用')
    expect(await wireCount(page)).toBe(1)

    // 键盘完成全部正确连线
    await keyboardConnect(page, 'A2', 'B1')
    await keyboardConnect(page, 'A3', 'B4')
    await keyboardConnect(page, 'A4', 'B2')
    expect(await wireCount(page)).toBe(4)
    await expect(page.getByTestId('bundle-status')).toHaveAttribute('data-status', 'pass')

    // 键盘删除一条线后，状态回到未完成且其余线保留
    await page.getByTestId('endpoint-A-A4').focus()
    await page.keyboard.press('Delete')
    expect(await wireCount(page)).toBe(3)
    await expect(page.getByTestId('bundle-status')).toHaveAttribute('data-status', 'incomplete')
    await expect(page.locator('[data-wire-id][data-a="A1"]')).toHaveAttribute('data-b', 'B3')

    // 键盘补接后重新通过
    await keyboardConnect(page, 'A4', 'B2')
    await expect(page.getByTestId('bundle-status')).toHaveAttribute('data-status', 'pass')
    await expect(page.getByTestId('bundle-pass')).toBeVisible()
  })
})
