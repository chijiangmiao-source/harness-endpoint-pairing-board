/**
 * 线束连线核验的纯裁决逻辑（无 DOM、无框架依赖），
 * 供 Vue 界面、单元测试与文档描述共用同一套规则。
 */

export type Side = 'A' | 'B'

/** 录入阶段的拒绝原因 */
export type MappingCode =
  | 'DUPLICATE_PIN'
  | 'EMPTY_EXPECTED'
  | 'EXPECTED_TARGET_MISSING'
  | 'EXPECTED_TARGET_DUPLICATED'
  | 'COVERAGE_INCOMPLETE'

/** 连线阶段的拒绝原因 */
export type ConnectionCode = 'ENDPOINT_OCCUPIED'

export interface MappingDefect {
  code: MappingCode
  message: string
  /** 关联的 A 端针位（问题应在该 A 端行旁反馈） */
  aPin?: string
  /** 关联的 B 端针位（问题应在该 B 端针位旁反馈） */
  bPin?: string
}

export interface MappingValidation {
  valid: boolean
  aPins: string[]
  bPins: string[]
  /** 已通过存在性检查的 A -> 预期 B 映射 */
  expectedByA: Map<string, string>
  defects: MappingDefect[]
}

/** 录入阶段完成后进入连线阶段的不可变快照（严格一一对应已成立） */
export interface MappingSnapshot {
  aPins: string[]
  bPins: string[]
  expectedByA: Map<string, string>
}

export interface Connection {
  id: string
  aPin: string
  bPin: string
}

export interface EndpointRef {
  side: Side
  pin: string
}

export type ConnectResult =
  | { accepted: true; connections: Connection[] }
  | {
      accepted: false
      code: ConnectionCode
      /** 被占用的端点，拒绝原因展示在它旁边 */
      occupied: EndpointRef
      /** 该端点上已存在的连线，必须保留 */
      existing: Connection
      message: string
    }

export type WireVerdict = 'correct' | 'wrong'

export interface AdjudicatedConnection {
  connection: Connection
  verdict: WireVerdict
  expectedB: string
  message: string
}

export type BundleStatus = 'incomplete' | 'complete_with_errors' | 'pass'

export interface BundleState {
  status: BundleStatus
  connectedA: Set<string>
  connectedB: Set<string>
  allConnected: boolean
  allCorrect: boolean
  adjudications: AdjudicatedConnection[]
  message: string
}

/** 按行拆分针位号：去除首尾空白，忽略空行，保持录入顺序 */
export function parsePinList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function uniquePreservingOrder(pins: string[]): string[] {
  return [...new Set(pins)]
}

/**
 * 校验预期映射：
 * - 针位号在各自一侧必须唯一；
 * - 每个 A 端针位都必须指定一个存在于 B 端清单中的预期针位；
 * - 每个 B 端针位最多（也必须）被一个 A 端针位指向。
 * 任一条件不满足都会返回带端点定位信息的 defects，valid 为 false。
 */
export function validateMapping(
  aRaw: string[],
  bRaw: string[],
  targets: Record<string, string>,
): MappingValidation {
  const defects: MappingDefect[] = []

  const aPins = uniquePreservingOrder(aRaw)
  const bPins = uniquePreservingOrder(bRaw)
  const bSet = new Set(bPins)

  if (aPins.length === 0) {
    defects.push({
      code: 'COVERAGE_INCOMPLETE',
      message: 'A 端至少需要录入一个针位号',
    })
  }
  if (bPins.length === 0) {
    defects.push({
      code: 'COVERAGE_INCOMPLETE',
      message: 'B 端至少需要录入一个针位号',
    })
  }

  // 同侧重复针位
  const aCounts = new Map<string, number>()
  for (const pin of aRaw) aCounts.set(pin, (aCounts.get(pin) ?? 0) + 1)
  for (const pin of aPins) {
    if ((aCounts.get(pin) ?? 0) > 1) {
      defects.push({
        code: 'DUPLICATE_PIN',
        aPin: pin,
        message: `A 端针位号「${pin}」重复，针位号必须唯一`,
      })
    }
  }
  const bCounts = new Map<string, number>()
  for (const pin of bRaw) bCounts.set(pin, (bCounts.get(pin) ?? 0) + 1)
  for (const pin of bPins) {
    if ((bCounts.get(pin) ?? 0) > 1) {
      defects.push({
        code: 'DUPLICATE_PIN',
        bPin: pin,
        message: `B 端针位号「${pin}」重复，针位号必须唯一`,
      })
    }
  }

  const expectedByA = new Map<string, string>()
  const ownersByB = new Map<string, string[]>()

  for (const aPin of aPins) {
    const rawTarget = (targets[aPin] ?? '').trim()
    if (rawTarget === '') {
      defects.push({
        code: 'EMPTY_EXPECTED',
        aPin,
        message: `A 端针位「${aPin}」尚未指定预期的 B 端针位`,
      })
      continue
    }
    if (!bSet.has(rawTarget)) {
      defects.push({
        code: 'EXPECTED_TARGET_MISSING',
        aPin,
        bPin: rawTarget,
        message: `A 端针位「${aPin}」的预期端「${rawTarget}」不在 B 端针位清单中`,
      })
      continue
    }
    expectedByA.set(aPin, rawTarget)
    const owners = ownersByB.get(rawTarget) ?? []
    owners.push(aPin)
    ownersByB.set(rawTarget, owners)
  }

  // 多个 A 端指向同一个 B 端
  for (const [bPin, owners] of ownersByB) {
    if (owners.length > 1) {
      for (const aPin of owners) {
        const others = owners.filter((other) => other !== aPin).join('、')
        defects.push({
          code: 'EXPECTED_TARGET_DUPLICATED',
          aPin,
          bPin,
          message: `B 端针位「${bPin}」被多个 A 端针位指向（${[aPin, ...owners.filter((o) => o !== aPin)].join('、')}，与 ${others} 冲突），预期关系必须一一对应`,
        })
      }
    }
  }

  // 每个 B 端都必须被覆盖
  for (const bPin of bPins) {
    if (!ownersByB.has(bPin)) {
      defects.push({
        code: 'COVERAGE_INCOMPLETE',
        bPin,
        message: `B 端针位「${bPin}」没有任何 A 端针位指向，预期关系必须覆盖两侧全部针位`,
      })
    }
  }

  return {
    valid: defects.length === 0,
    aPins,
    bPins,
    expectedByA,
    defects,
  }
}

/**
 * 尝试新增一条连线。
 * 任一端点已被占用即拒绝，且返回原连线集合（原线保留）。
 */
export function tryConnect(
  connections: Connection[],
  aPin: string,
  bPin: string,
  nextId: () => string,
): ConnectResult {
  const existingOnA = connections.find((wire) => wire.aPin === aPin)
  if (existingOnA) {
    return {
      accepted: false,
      code: 'ENDPOINT_OCCUPIED',
      occupied: { side: 'A', pin: aPin },
      existing: existingOnA,
      message: `A 端针位「${aPin}」已与 B 端「${existingOnA.bPin}」连接，一个端点最多参与一条线，已拒绝重复连接`,
    }
  }
  const existingOnB = connections.find((wire) => wire.bPin === bPin)
  if (existingOnB) {
    return {
      accepted: false,
      code: 'ENDPOINT_OCCUPIED',
      occupied: { side: 'B', pin: bPin },
      existing: existingOnB,
      message: `B 端针位「${bPin}」已与 A 端「${existingOnB.aPin}」连接，一个端点最多参与一条线，已拒绝重复连接`,
    }
  }
  return {
    accepted: true,
    connections: [...connections, { id: nextId(), aPin, bPin }],
  }
}

export function removeConnection(connections: Connection[], id: string): Connection[] {
  return connections.filter((wire) => wire.id !== id)
}

/** 依据预期映射裁决每条现存连线，正确为中性，错接给出预期对端 */
export function adjudicate(
  connections: Connection[],
  expectedByA: Map<string, string>,
): AdjudicatedConnection[] {
  return connections.map((connection) => {
    const expectedB = expectedByA.get(connection.aPin) ?? ''
    const correct = expectedB === connection.bPin
    return {
      connection,
      verdict: correct ? 'correct' : 'wrong',
      expectedB,
      message: correct
        ? `连接正确：${connection.aPin} ↔ ${connection.bPin}`
        : `错接：${connection.aPin} 实际接到 ${connection.bPin}，预期应接 ${expectedB}`,
    }
  })
}

/** 整束状态：全部端点已连接且每条线都正确才通过 */
export function evaluateBundle(
  aPins: string[],
  bPins: string[],
  connections: Connection[],
  expectedByA: Map<string, string>,
): BundleState {
  const connectedA = new Set(connections.map((wire) => wire.aPin))
  const connectedB = new Set(connections.map((wire) => wire.bPin))
  const allConnected =
    aPins.every((pin) => connectedA.has(pin)) &&
    bPins.every((pin) => connectedB.has(pin))
  const adjudications = adjudicate(connections, expectedByA)
  const allCorrect = adjudications.every((item) => item.verdict === 'correct')

  let status: BundleStatus
  let message: string
  if (!allConnected) {
    status = 'incomplete'
    message = `尚未完成：A 端已连接 ${connectedA.size}/${aPins.length}，B 端已连接 ${connectedB.size}/${bPins.length}`
  } else if (!allCorrect) {
    const wrongCount = adjudications.filter((item) => item.verdict === 'wrong').length
    status = 'complete_with_errors'
    message = `全部端点已连接，但存在 ${wrongCount} 条错接线，请删除错线后重新补接`
  } else {
    status = 'pass'
    message = `整束核验通过：${connections.length} 条连线全部符合预期`
  }

  return { status, connectedA, connectedB, allConnected, allCorrect, adjudications, message }
}
