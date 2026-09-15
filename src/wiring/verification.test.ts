import { describe, expect, it } from 'vitest'
import {
  adjudicate,
  displayIndexOf,
  evaluateBundle,
  parsePinList,
  projectPins,
  removeConnection,
  STANDARD_FACES,
  toggleFace,
  tryConnect,
  validateMapping,
  type Connection,
  type ViewFaces,
} from './verification'

let idCounter = 0
const nextId = () => `wire-${++idCounter}`

function targetsOf(pairs: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(pairs)
}

describe('parsePinList', () => {
  it('去除空行与首尾空白并保持顺序', () => {
    expect(parsePinList('  A1 \n\nA2\n  ')).toEqual(['A1', 'A2'])
  })
})

describe('validateMapping - 合法映射', () => {
  it('两侧数量相同且一一对应时通过', () => {
    const result = validateMapping(
      ['A1', 'A2', 'A3'],
      ['B1', 'B2', 'B3'],
      targetsOf([
        ['A1', 'B2'],
        ['A2', 'B3'],
        ['A3', 'B1'],
      ]),
    )
    expect(result.valid).toBe(true)
    expect(result.defects).toEqual([])
    expect([...result.expectedByA.entries()]).toEqual([
      ['A1', 'B2'],
      ['A2', 'B3'],
      ['A3', 'B1'],
    ])
  })

  it('预期值两端空白被容忍', () => {
    const result = validateMapping(['A1'], ['B1'], { A1: ' B1 ' })
    expect(result.valid).toBe(true)
  })
})

describe('validateMapping - 拒绝原因', () => {
  it('A 端针位重复', () => {
    const result = validateMapping(['A1', 'A1'], ['B1', 'B2'], { A1: 'B1' })
    expect(result.valid).toBe(false)
    const dup = result.defects.find((d) => d.code === 'DUPLICATE_PIN')
    expect(dup?.aPin).toBe('A1')
  })

  it('B 端针位重复', () => {
    const result = validateMapping(
      ['A1', 'A2'],
      ['B1', 'B1'],
      targetsOf([
        ['A1', 'B1'],
        ['A2', 'B1'],
      ]),
    )
    expect(result.valid).toBe(false)
    expect(result.defects.some((d) => d.code === 'DUPLICATE_PIN' && d.bPin === 'B1')).toBe(true)
  })

  it('某 A 端未指定预期端', () => {
    const result = validateMapping(['A1', 'A2'], ['B1', 'B2'], { A1: 'B1', A2: '' })
    expect(result.valid).toBe(false)
    const defect = result.defects.find((d) => d.code === 'EMPTY_EXPECTED')
    expect(defect?.aPin).toBe('A2')
  })

  it('预期端不存在于 B 端清单', () => {
    const result = validateMapping(
      ['A1', 'A2'],
      ['B1', 'B2'],
      targetsOf([
        ['A1', 'B9'],
        ['A2', 'B2'],
      ]),
    )
    expect(result.valid).toBe(false)
    const defect = result.defects.find((d) => d.code === 'EXPECTED_TARGET_MISSING')
    expect(defect?.aPin).toBe('A1')
    expect(defect?.bPin).toBe('B9')
  })

  it('多个 A 端指向同一 B 端', () => {
    const result = validateMapping(
      ['A1', 'A2', 'A3'],
      ['B1', 'B2', 'B3'],
      targetsOf([
        ['A1', 'B2'],
        ['A2', 'B2'],
        ['A3', 'B3'],
      ]),
    )
    expect(result.valid).toBe(false)
    const dups = result.defects.filter((d) => d.code === 'EXPECTED_TARGET_DUPLICATED')
    expect(dups.map((d) => d.aPin).sort()).toEqual(['A1', 'A2'])
    expect(dups.every((d) => d.bPin === 'B2')).toBe(true)
    // B1 未被覆盖，应一并报告
    expect(result.defects.some((d) => d.code === 'COVERAGE_INCOMPLETE' && d.bPin === 'B1')).toBe(
      true,
    )
  })

  it('B 端数量多于已指定映射时报告未覆盖针位', () => {
    const result = validateMapping(['A1'], ['B1', 'B2'], { A1: 'B1' })
    expect(result.valid).toBe(false)
    expect(result.defects.some((d) => d.code === 'COVERAGE_INCOMPLETE' && d.bPin === 'B2')).toBe(
      true,
    )
  })

  it('A 端数量多于 B 端时必然出现重复指向而被拒绝', () => {
    const result = validateMapping(
      ['A1', 'A2'],
      ['B1'],
      targetsOf([
        ['A1', 'B1'],
        ['A2', 'B1'],
      ]),
    )
    expect(result.valid).toBe(false)
    expect(result.defects.some((d) => d.code === 'EXPECTED_TARGET_DUPLICATED')).toBe(true)
  })

  it('两侧均为空时拒绝', () => {
    const result = validateMapping([], [], {})
    expect(result.valid).toBe(false)
    expect(result.defects.filter((d) => d.code === 'COVERAGE_INCOMPLETE')).toHaveLength(2)
  })
})

describe('tryConnect - 端点占用裁决', () => {
  it('首条连线被接受', () => {
    const result = tryConnect([], 'A1', 'B1', nextId)
    expect(result.accepted).toBe(true)
    if (result.accepted) expect(result.connections).toHaveLength(1)
  })

  it('A 端第二次占用被拒绝并保留原线', () => {
    const first = tryConnect([], 'A1', 'B1', nextId)
    if (!first.accepted) throw new Error('前置连线应成功')
    const second = tryConnect(first.connections, 'A1', 'B2', nextId)
    expect(second.accepted).toBe(false)
    if (!second.accepted) {
      expect(second.code).toBe('ENDPOINT_OCCUPIED')
      expect(second.occupied).toEqual({ side: 'A', pin: 'A1' })
      expect(second.existing).toEqual(first.connections[0])
    }
  })

  it('B 端第二次占用被拒绝并保留原线', () => {
    const first = tryConnect([], 'A1', 'B1', nextId)
    if (!first.accepted) throw new Error('前置连线应成功')
    const second = tryConnect(first.connections, 'A2', 'B1', nextId)
    expect(second.accepted).toBe(false)
    if (!second.accepted) {
      expect(second.occupied).toEqual({ side: 'B', pin: 'B1' })
      expect(second.existing).toEqual(first.connections[0])
    }
  })

  it('拒绝时原集合内容不变，其他端点仍可继续连线', () => {
    const first = tryConnect([], 'A1', 'B1', nextId)
    if (!first.accepted) throw new Error('前置连线应成功')
    const rejected = tryConnect(first.connections, 'A1', 'B2', nextId)
    expect(rejected.accepted).toBe(false)
    const third = tryConnect(first.connections, 'A2', 'B2', nextId)
    expect(third.accepted).toBe(true)
    if (third.accepted) {
      expect(third.connections).toHaveLength(2)
      expect(third.connections[0]).toEqual(first.connections[0])
    }
  })
})

describe('removeConnection', () => {
  it('仅删除指定连线，其余保留', () => {
    let wires: Connection[] = []
    for (const [a, b] of [
      ['A1', 'B1'],
      ['A2', 'B2'],
    ] as const) {
      const r = tryConnect(wires, a, b, nextId)
      if (!r.accepted) throw new Error('前置连线应成功')
      wires = r.connections
    }
    const remaining = removeConnection(wires, wires[0].id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toEqual(wires[1])
  })
})

describe('adjudicate - 单条线裁决', () => {
  const expected = new Map([
    ['A1', 'B2'],
    ['A2', 'B1'],
  ])

  it('正确线为中性裁决 correct', () => {
    const [verdict] = adjudicate([{ id: 'w', aPin: 'A1', bPin: 'B2' }], expected)
    expect(verdict.verdict).toBe('correct')
  })

  it('错接线为 wrong，且信息指出预期对端', () => {
    const [verdict] = adjudicate([{ id: 'w', aPin: 'A1', bPin: 'B1' }], expected)
    expect(verdict.verdict).toBe('wrong')
    expect(verdict.expectedB).toBe('B2')
    expect(verdict.message).toContain('B2')
    expect(verdict.message).toContain('A1')
  })
})

describe('evaluateBundle - 整束状态与修复链路', () => {
  const a = ['A1', 'A2', 'A3']
  const b = ['B1', 'B2', 'B3']
  const expected = new Map([
    ['A1', 'B1'],
    ['A2', 'B2'],
    ['A3', 'B3'],
  ])

  it('无线时为 incomplete', () => {
    expect(evaluateBundle(a, b, [], expected).status).toBe('incomplete')
  })

  it('部分连接时为 incomplete', () => {
    const r = tryConnect([], 'A1', 'B1', nextId)
    if (!r.accepted) throw new Error('前置连线应成功')
    expect(evaluateBundle(a, b, r.connections, expected).status).toBe('incomplete')
  })

  it('全部连接但有错线时为 complete_with_errors', () => {
    let wires: Connection[] = []
    // A2 与 A3 交叉错接
    for (const [x, y] of [
      ['A1', 'B1'],
      ['A2', 'B3'],
      ['A3', 'B2'],
    ] as const) {
      const r = tryConnect(wires, x, y, nextId)
      if (!r.accepted) throw new Error('前置连线应成功')
      wires = r.connections
    }
    const state = evaluateBundle(a, b, wires, expected)
    expect(state.status).toBe('complete_with_errors')
    expect(state.allConnected).toBe(true)
    expect(state.adjudications.filter((item) => item.verdict === 'wrong')).toHaveLength(2)
  })

  it('全部正确才 pass', () => {
    let wires: Connection[] = []
    for (const [x, y] of [
      ['A1', 'B1'],
      ['A2', 'B2'],
      ['A3', 'B3'],
    ] as const) {
      const r = tryConnect(wires, x, y, nextId)
      if (!r.accepted) throw new Error('前置连线应成功')
      wires = r.connections
    }
    expect(evaluateBundle(a, b, wires, expected).status).toBe('pass')
  })

  it('删除错线后可直接补接，且不丢失其余正确关系，最终通过', () => {
    let wires: Connection[] = []
    for (const [x, y] of [
      ['A1', 'B1'], // 正确，应自始至终保留
      ['A2', 'B3'], // 错接
      ['A3', 'B2'], // 错接（与 A2 交叉）
    ] as const) {
      const r = tryConnect(wires, x, y, nextId)
      if (!r.accepted) throw new Error('前置连线应成功')
      wires = r.connections
    }
    expect(evaluateBundle(a, b, wires, expected).status).toBe('complete_with_errors')

    // 删除两条错线
    const wrongs = evaluateBundle(a, b, wires, expected).adjudications.filter(
      (item) => item.verdict === 'wrong',
    )
    wires = removeConnection(wires, wrongs[0].connection.id)
    wires = removeConnection(wires, wrongs[1].connection.id)

    // A1 的正确线仍在，状态回到 incomplete
    const partial = evaluateBundle(a, b, wires, expected)
    expect(partial.status).toBe('incomplete')
    expect(wires).toHaveLength(1)
    expect(wires[0]).toEqual({ id: expect.any(String), aPin: 'A1', bPin: 'B1' })

    // 直接补接为正确关系
    for (const [x, y] of [
      ['A2', 'B2'],
      ['A3', 'B3'],
    ] as const) {
      const r = tryConnect(wires, x, y, nextId)
      expect(r.accepted).toBe(true)
      if (r.accepted) wires = r.connections
    }
    expect(evaluateBundle(a, b, wires, expected).status).toBe('pass')
  })
})

describe('观察面投影 - 双端投影不改变映射裁决', () => {
  const a = ['A1', 'A2', 'A3', 'A4']
  const b = ['B1', 'B2', 'B3', 'B4']
  // 示例交叉预期：A1→B3、A2→B1、A3→B4、A4→B2
  const expected = new Map([
    ['A1', 'B3'],
    ['A2', 'B1'],
    ['A3', 'B4'],
    ['A4', 'B2'],
  ])

  function buildWires(pairs: Array<[string, string]>): Connection[] {
    let wires: Connection[] = []
    for (const [x, y] of pairs) {
      const r = tryConnect(wires, x, y, nextId)
      if (!r.accepted) throw new Error('前置连线应成功')
      wires = r.connections
    }
    return wires
  }

  /** 用同一组针位号身份的连线，在各种观察面组合下裁决必须完全一致 */
  const facePairs: Array<[string, ViewFaces]> = [
    ['两端正序', { A: 'standard', B: 'standard' }],
    ['仅 A 倒序', { A: 'reversed', B: 'standard' }],
    ['仅 B 倒序', { A: 'standard', B: 'reversed' }],
    ['两端倒序', { A: 'reversed', B: 'reversed' }],
  ]

  it('projectPins 正序保持排列，倒序整体反转且不修改原数组', () => {
    expect(projectPins(a, 'standard')).toEqual(['A1', 'A2', 'A3', 'A4'])
    expect(projectPins(a, 'reversed')).toEqual(['A4', 'A3', 'A2', 'A1'])
    expect(a).toEqual(['A1', 'A2', 'A3', 'A4'])
  })

  it('displayIndexOf 把针位号映射到当前观察面的显示行号', () => {
    expect(displayIndexOf(a, 'A1', 'standard')).toBe(0)
    expect(displayIndexOf(a, 'A4', 'standard')).toBe(3)
    expect(displayIndexOf(a, 'A1', 'reversed')).toBe(3)
    expect(displayIndexOf(a, 'A4', 'reversed')).toBe(0)
    expect(displayIndexOf(a, 'A3', 'reversed')).toBe(1)
  })

  it('默认观察面 STANDARD_FACES 两端均为正序', () => {
    expect(STANDARD_FACES).toEqual({ A: 'standard', B: 'standard' })
  })

  it('toggleFace 只翻转指定一端，另一端不变；再次翻转可还原', () => {
    const once = toggleFace(STANDARD_FACES, 'B')
    expect(once).toEqual({ A: 'standard', B: 'reversed' })
    expect(STANDARD_FACES).toEqual({ A: 'standard', B: 'standard' })
    const twice = toggleFace(once, 'B')
    expect(twice).toEqual({ A: 'standard', B: 'standard' })
    const aOnly = toggleFace(once, 'A')
    expect(aOnly).toEqual({ A: 'reversed', B: 'reversed' })
    expect(once).toEqual({ A: 'standard', B: 'reversed' })
  })

  it.each(facePairs)('观察面组合【%s】下全部正确连线裁决仍为 pass', (_name, _faces) => {
    const wires = buildWires([
      ['A1', 'B3'],
      ['A2', 'B1'],
      ['A3', 'B4'],
      ['A4', 'B2'],
    ])
    // 裁决只读取针位号身份，不接收观察面，结果必须与正序时一致
    const state = evaluateBundle(a, b, wires, expected)
    expect(state.status).toBe('pass')
    expect(state.adjudications.every((item) => item.verdict === 'correct')).toBe(true)
  })

  it.each(facePairs)('观察面组合【%s】下错接的线仍裁决为 wrong 且预期对端不变', (_name, _faces) => {
    // A2 误接 B2（预期 B1）、A4 误接 B1（预期 B2）
    const wires = buildWires([
      ['A1', 'B3'],
      ['A2', 'B2'],
      ['A3', 'B4'],
      ['A4', 'B1'],
    ])
    const state = evaluateBundle(a, b, wires, expected)
    expect(state.status).toBe('complete_with_errors')
    const wrongs = state.adjudications.filter((item) => item.verdict === 'wrong')
    expect(wrongs.map((item) => [item.connection.aPin, item.connection.bPin, item.expectedB]))
      .toEqual([
        ['A2', 'B2', 'B1'],
        ['A4', 'B1', 'B2'],
      ])
  })

  it('倒序投影只是排列变化，针位号集合与投影的双射性质保持', () => {
    for (const [, faces] of facePairs) {
      const da = projectPins(a, faces.A)
      const db = projectPins(b, faces.B)
      expect([...da].sort()).toEqual([...a].sort())
      expect([...db].sort()).toEqual([...b].sort())
      expect(new Set(da).size).toBe(a.length)
      expect(new Set(db).size).toBe(b.length)
    }
  })
})
