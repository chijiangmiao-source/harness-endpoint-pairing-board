<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  evaluateBundle,
  removeConnection,
  tryConnect,
  type BundleState,
  type Connection,
  type EndpointRef,
  type Side,
} from '../wiring/verification'
import type { MappingSnapshot } from '../wiring/verification'

const props = defineProps<{ mapping: MappingSnapshot }>()
const emit = defineEmits<{ back: [] }>()

const X_A = 150
const X_B = 750
const TOP = 72
const ROW_H = 68

let wireSeq = 0
const nextWireId = () => `wire-${Date.now().toString(36)}-${++wireSeq}`

const connections = ref<Connection[]>([])
const selected = ref<EndpointRef | null>(null)

interface DragState {
  side: Side
  pin: string
  x: number
  y: number
}
const drag = ref<DragState | null>(null)

interface Rejection {
  side: Side
  pin: string
  message: string
  nonce: number
}
const rejection = ref<Rejection | null>(null)
const liveMessage = ref('连线阶段已就绪：拖拽针位，或用 Tab 聚焦后按 Enter 选择两端建立连线。')

let rejectionTimer: ReturnType<typeof setTimeout> | undefined

const svgEl = ref<SVGSVGElement | null>(null)
const aPins = computed(() => props.mapping.aPins)
const bPins = computed(() => props.mapping.bPins)
const expectedByA = computed(() => props.mapping.expectedByA)

const aIndex = computed(() => new Map(aPins.value.map((pin, i) => [pin, i])))
const bIndex = computed(() => new Map(bPins.value.map((pin, i) => [pin, i])))

function yOf(side: Side, pin: string): number {
  const index = (side === 'A' ? aIndex.value : bIndex.value).get(pin) ?? 0
  return TOP + index * ROW_H
}

const xOf = (side: Side) => (side === 'A' ? X_A : X_B)

const boardHeight = computed(
  () => TOP + Math.max(aPins.value.length, bPins.value.length) * ROW_H + 8,
)

const bundle = computed<BundleState>(() =>
  evaluateBundle(aPins.value, bPins.value, connections.value, expectedByA.value),
)

const wireByA = computed(() => {
  const map = new Map<string, Connection>()
  for (const wire of connections.value) map.set(wire.aPin, wire)
  return map
})
const wireByB = computed(() => {
  const map = new Map<string, Connection>()
  for (const wire of connections.value) map.set(wire.bPin, wire)
  return map
})
const verdictByA = computed(() => {
  const map = new Map(bundle.value.adjudications.map((item) => [item.connection.aPin, item]))
  return map
})

function announce(message: string) {
  liveMessage.value = message
}

function showRejection(side: Side, pin: string, message: string) {
  rejection.value = { side, pin, message, nonce: Date.now() }
  announce(message)
  if (rejectionTimer) clearTimeout(rejectionTimer)
  rejectionTimer = setTimeout(() => {
    rejection.value = null
  }, 8000)
}

function attemptConnect(aPin: string, bPin: string) {
  const result = tryConnect(connections.value, aPin, bPin, nextWireId)
  if (result.accepted) {
    connections.value = result.connections
    rejection.value = null
    selected.value = null
    const expected = expectedByA.value.get(aPin)
    const correct = expected === bPin
    announce(
      correct
        ? `已建立连线 ${aPin} 到 ${bPin}，符合预期。`
        : `已建立连线 ${aPin} 到 ${bPin}，但这是错接：${aPin} 的预期对端是 ${expected}。请删除该红线后补接正确针位。`,
    )
    return
  }
  // 拒绝原因反馈在被占用的端点旁（短句）；完整原因进 live 区域，原线保留
  const otherEnd = result.occupied.side === 'A' ? result.existing.bPin : result.existing.aPin
  showRejection(
    result.occupied.side,
    result.occupied.pin,
    `该端点已占用（已与 ${otherEnd} 连接），拒绝重复连接`,
  )
  announce(result.message)
}

function deleteWire(id: string) {
  const target = connections.value.find((wire) => wire.id === id)
  connections.value = removeConnection(connections.value, id)
  rejection.value = null
  if (selected.value && target && (selected.value.pin === target.aPin || selected.value.pin === target.bPin)) {
    selected.value = null
  }
  if (target) announce(`已删除连线 ${target.aPin} 与 ${target.bPin}，两端可重新补接，其余连线保留。`)
}

function sameSideRejection(first: EndpointRef, second: EndpointRef) {
  const message = `只能在 A 端与 B 端之间建立连线：${first.side}${first.pin} 与 ${second.side}${second.pin} 位于同一侧，已拒绝。`
  showRejection(second.side, second.pin, message)
}

function endpointAriaLabel(side: Side, pin: string): string {
  const wire = (side === 'A' ? wireByA.value : wireByB.value).get(pin)
  const parts = [`${side} 端针位 ${pin}`]
  if (side === 'A') parts.push(`预期对端 ${expectedByA.value.get(pin) ?? ''}`)
  if (wire) parts.push(`已连接 ${wire.aPin} 与 ${wire.bPin}`)
  else parts.push('空闲')
  if (selected.value?.side === side && selected.value?.pin === pin) parts.push('已选中，等待选择另一端')
  return parts.join('，')
}

/* ---------------- 鼠标 / 触屏拖拽 ---------------- */

function toSvgPoint(event: PointerEvent): { x: number; y: number } {
  const svg = svgEl.value
  if (!svg) return { x: 0, y: 0 }
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const point = new DOMPoint(event.clientX, event.clientY)
  const transformed = point.matrixTransform(ctm.inverse())
  return { x: transformed.x, y: transformed.y }
}

function onEndpointPointerDown(event: PointerEvent, side: Side, pin: string) {
  event.preventDefault()
  ;(event.currentTarget as SVGElement).focus?.()
  const p = toSvgPoint(event)
  drag.value = { side, pin, x: p.x, y: p.y }
  announce(`${side} 端针位 ${pin} 已抓起，请拖到另一侧的针位后松开。`)
}

function onSvgPointerMove(event: PointerEvent) {
  if (!drag.value) return
  drag.value = { ...drag.value, ...toSvgPoint(event) }
}

function endpointFromElement(target: EventTarget | null, clientX?: number, clientY?: number) {
  let el = target instanceof Element ? target : null
  let hit = el?.closest?.('[data-endpoint]') as Element | null | undefined
  if (!hit && clientX !== undefined && clientY !== undefined) {
    hit = document.elementFromPoint(clientX, clientY)?.closest('[data-endpoint]') ?? null
  }
  if (!hit) return null
  const side = hit.getAttribute('data-side') as Side | null
  const pin = hit.getAttribute('data-pin')
  if (!side || !pin) return null
  return { side, pin, element: hit }
}

function finishDrag(event: PointerEvent) {
  const current = drag.value
  if (!current) return
  const target = endpointFromElement(event.target, event.clientX, event.clientY)
  drag.value = null
  if (!target) {
    announce('已取消拖拽：未落在针位上。')
    return
  }
  if (target.side === current.side) {
    sameSideRejection({ side: current.side, pin: current.pin }, { side: target.side, pin: target.pin })
    return
  }
  if (current.side === 'A') attemptConnect(current.pin, target.pin)
  else attemptConnect(target.pin, current.pin)
}

function cancelDrag() {
  if (drag.value) {
    drag.value = null
    announce('已取消拖拽。')
  }
}

/* ---------------- 键盘选择 ---------------- */

function onEndpointKeydown(event: KeyboardEvent, side: Side, pin: string) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const current: EndpointRef = { side, pin }
    if (!selected.value) {
      selected.value = current
      announce(`已选中 ${side} 端针位 ${pin}，请聚焦另一侧针位后按 Enter 完成连线；按 Esc 取消。`)
      return
    }
    const first = selected.value
    if (first.side === side && first.pin === pin) {
      selected.value = null
      announce('已取消选择。')
      return
    }
    selected.value = null
    if (first.side === side) {
      sameSideRejection(first, current)
      return
    }
    if (side === 'B') attemptConnect(first.pin, pin)
    else attemptConnect(pin, first.pin)
    return
  }
  if (event.key === 'Escape') {
    selected.value = null
    announce('已取消选择。')
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    const wire = (side === 'A' ? wireByA.value : wireByB.value).get(pin)
    if (wire) {
      event.preventDefault()
      deleteWire(wire.id)
    }
  }
}

function isSelected(side: Side, pin: string) {
  return selected.value?.side === side && selected.value?.pin === pin
}

function isOccupied(side: Side, pin: string) {
  return (side === 'A' ? wireByA.value : wireByB.value).has(pin)
}

function rejectionFor(side: Side, pin: string) {
  return rejection.value && rejection.value.side === side && rejection.value.pin === pin
    ? rejection.value.message
    : null
}

function wirePath(wire: Connection): string {
  const x1 = X_A
  const y1 = yOf('A', wire.aPin)
  const x2 = X_B
  const y2 = yOf('B', wire.bPin)
  const mid = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

/**
 * 删除按钮放在曲线靠近 A 端 t=0.18 处：
 * 每个 A 端针位最多一条线且各行高度不同，因此这些点天然不会互相重叠。
 */
function deletePoint(wire: Connection): { x: number; y: number } {
  const x1 = X_A
  const y1 = yOf('A', wire.aPin)
  const x2 = X_B
  const y2 = yOf('B', wire.bPin)
  const mid = (x1 + x2) / 2
  const t = 0.18
  const u = 1 - t
  const x = u ** 3 * x1 + 3 * u * u * t * mid + 3 * u * t * t * mid + t ** 3 * x2
  const y = u ** 3 * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y2
  return { x, y }
}

/**
 * 错接标签放在曲线靠近 B 端 t=0.72 处：
 * 与删除按钮分居两侧，且按 B 端行高错开，交叉线的标签也不会互相覆盖。
 */
function labelPoint(wire: Connection): { x: number; y: number } {
  const x1 = X_A
  const y1 = yOf('A', wire.aPin)
  const x2 = X_B
  const y2 = yOf('B', wire.bPin)
  const mid = (x1 + x2) / 2
  const t = 0.72
  const u = 1 - t
  const x = u ** 3 * x1 + 3 * u * u * t * mid + 3 * u * t * t * mid + t ** 3 * x2
  const y = u ** 3 * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y2
  return { x, y }
}

/** 估算 SVG 文本宽度：中文按全宽、其余按半宽（字号 12px） */
function estimateTextWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    width += /[⺀-鿿＀-￯　-〿]/.test(ch) ? 13 : 7.5
  }
  return width
}

function wrongLabelText(item: { connection: Connection; expectedB: string }): string {
  return `✗ ${item.connection.aPin} 接到 ${item.connection.bPin}，预期 ${item.expectedB}`
}

const dragPath = computed(() => {
  const d = drag.value
  if (!d) return null
  const sx = xOf(d.side)
  const sy = yOf(d.side, d.pin)
  const mid = (sx + d.x) / 2
  return d.side === 'A'
    ? `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${d.y}, ${d.x} ${d.y}`
    : `M ${d.x} ${d.y} C ${mid} ${d.y}, ${mid} ${sy}, ${sx} ${sy}`
})

onMounted(() => window.addEventListener('pointerup', cancelDrag))
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', cancelDrag)
  if (rejectionTimer) clearTimeout(rejectionTimer)
})
</script>

<template>
  <div>
    <section class="panel">
      <div class="board-head">
        <h2>连线核验</h2>
        <button type="button" data-testid="back-to-entry" @click="emit('back')">
          ← 返回修改录入
        </button>
      </div>
      <p class="hint">
        操作方式：用鼠标把一侧针位<strong>拖拽</strong>到另一侧针位；或用
        <kbd>Tab</kbd> 聚焦针位，按 <kbd>Enter</kbd>/<kbd>空格</kbd> 依次选择两端建立连线，
        <kbd>Esc</kbd> 取消选择，焦点在已连接针位上时按 <kbd>Delete</kbd> 删除其连线。
        每个端点最多参与一条线，重复占用会在该端点旁被拒绝，原线保留。
      </p>
      <p class="live sr-only" aria-live="assertive" data-testid="live-region">{{ liveMessage }}</p>

      <div class="expected-strip" data-testid="expected-list">
        <span class="strip-label">预期关系：</span>
        <span v-for="pin in aPins" :key="pin" class="expected-chip">
          {{ pin }} → {{ expectedByA.get(pin) }}
        </span>
      </div>

      <div class="legend">
        <span><i class="swatch correct"></i> 中性色：符合预期</span>
        <span><i class="swatch wrong"></i> 红色：错接（标注预期对端）</span>
        <span><i class="swatch free"></i> 实心：已占用</span>
      </div>

      <svg
        ref="svgEl"
        class="board"
        :viewBox="`0 0 900 ${boardHeight}`"
        role="application"
        aria-label="针位连线板"
        @pointermove="onSvgPointerMove"
        @pointerup="finishDrag"
        @pointercancel="cancelDrag"
      >
        <!-- 已建立的连线 -->
        <path
          v-for="item in bundle.adjudications"
          :key="item.connection.id"
          :data-testid="`wire-${item.connection.id}`"
          :data-wire-id="item.connection.id"
          :data-a="item.connection.aPin"
          :data-b="item.connection.bPin"
          :data-verdict="item.verdict"
          :d="wirePath(item.connection)"
          class="wire"
          :class="item.verdict"
          fill="none"
        />
        <!-- 错接线的预期对端标注 -->
        <g
          v-for="item in bundle.adjudications.filter((i) => i.verdict === 'wrong')"
          :key="`label-${item.connection.id}`"
          :data-testid="`wire-label-${item.connection.id}`"
          class="wire-label"
          :transform="`translate(${labelPoint(item.connection).x}, ${labelPoint(item.connection).y - 14})`"
        >
          <rect
            :x="-(estimateTextWidth(wrongLabelText(item)) + 16) / 2"
            y="-13"
            :width="estimateTextWidth(wrongLabelText(item)) + 16"
            height="20"
            rx="4"
            fill="#fff5f5"
            stroke="#f3b4b4"
          />
          <text text-anchor="middle" dominant-baseline="central" class="wire-label-text">
            {{ wrongLabelText(item) }}
          </text>
        </g>

        <!-- 删除按钮（靠近 A 端，不同 A 行永不重叠） -->
        <g
          v-for="item in bundle.adjudications"
          :key="`del-${item.connection.id}`"
          class="wire-delete"
          :data-testid="`wire-delete-${item.connection.id}`"
          :data-wire-id="item.connection.id"
          role="button"
          tabindex="0"
          :aria-label="`删除连线 ${item.connection.aPin} 与 ${item.connection.bPin}`"
          :transform="`translate(${deletePoint(item.connection).x}, ${deletePoint(item.connection).y})`"
          @click.stop="deleteWire(item.connection.id)"
          @keydown.enter.prevent="deleteWire(item.connection.id)"
          @keydown.space.prevent="deleteWire(item.connection.id)"
        >
          <circle r="10" fill="#ffffff" :class="['del-circle', item.verdict]" />
          <text text-anchor="middle" dominant-baseline="central" class="del-text">×</text>
        </g>

        <!-- 拖拽中的预览线 -->
        <path v-if="dragPath" :d="dragPath" class="drag-preview" fill="none" />

        <!-- A 端针位 -->
        <g
          v-for="pin in aPins"
          :key="`A-${pin}`"
          :transform="`translate(${X_A}, ${yOf('A', pin)})`"
          class="endpoint"
          :class="{ selected: isSelected('A', pin), occupied: isOccupied('A', pin) }"
          data-endpoint="true"
          data-side="A"
          :data-pin="pin"
          :data-testid="`endpoint-A-${pin}`"
          role="button"
          tabindex="0"
          :aria-label="endpointAriaLabel('A', pin)"
          :aria-pressed="isSelected('A', pin)"
          @pointerdown="onEndpointPointerDown($event, 'A', pin)"
          @keydown="onEndpointKeydown($event, 'A', pin)"
        >
          <circle r="17" fill="transparent" class="hit-area" />
          <circle r="10" class="pin-circle" :class="{ wrong: verdictByA.get(pin)?.verdict === 'wrong' }" />
          <text x="-16" y="1" text-anchor="end" class="pin-name">A · {{ pin }}</text>
          <text
            v-if="verdictByA.get(pin)?.verdict === 'wrong'"
            x="-16"
            y="18"
            text-anchor="end"
            class="pin-sub wrong-text"
            :data-testid="`endpoint-expected-A-${pin}`"
          >
            ✗ 应接 {{ verdictByA.get(pin)?.expectedB }}
          </text>
          <text v-else x="-16" y="18" text-anchor="end" class="pin-sub">
            预期 {{ expectedByA.get(pin) }}
          </text>
          <text
            v-if="rejectionFor('A', pin)"
            :key="rejection?.nonce"
            x="16"
            y="5"
            text-anchor="start"
            class="endpoint-error"
            :data-testid="`endpoint-error-A-${pin}`"
          >
            {{ rejectionFor('A', pin) }}
          </text>
        </g>

        <!-- B 端针位 -->
        <g
          v-for="pin in bPins"
          :key="`B-${pin}`"
          :transform="`translate(${X_B}, ${yOf('B', pin)})`"
          class="endpoint"
          :class="{ selected: isSelected('B', pin), occupied: isOccupied('B', pin) }"
          data-endpoint="true"
          data-side="B"
          :data-pin="pin"
          :data-testid="`endpoint-B-${pin}`"
          role="button"
          tabindex="0"
          :aria-label="endpointAriaLabel('B', pin)"
          :aria-pressed="isSelected('B', pin)"
          @pointerdown="onEndpointPointerDown($event, 'B', pin)"
          @keydown="onEndpointKeydown($event, 'B', pin)"
        >
          <circle r="17" fill="transparent" class="hit-area" />
          <circle r="10" class="pin-circle" />
          <text x="16" y="1" text-anchor="start" class="pin-name">{{ pin }} · B</text>
          <text v-if="wireByB.get(pin)" x="16" y="18" text-anchor="start" class="pin-sub">
            来自 {{ wireByB.get(pin)?.aPin }}
          </text>
          <text
            v-if="rejectionFor('B', pin)"
            :key="rejection?.nonce"
            x="-16"
            y="5"
            text-anchor="end"
            class="endpoint-error"
            :data-testid="`endpoint-error-B-${pin}`"
          >
            {{ rejectionFor('B', pin) }}
          </text>
        </g>
      </svg>
    </section>

    <section class="panel">
      <h2>整束状态</h2>
      <div
        class="alert"
        :class="{
          ok: bundle.status === 'pass',
          error: bundle.status === 'complete_with_errors',
          info: bundle.status === 'incomplete',
        }"
        data-testid="bundle-status"
        :data-status="bundle.status"
      >
        {{ bundle.message }}
      </div>
      <div v-if="bundle.status === 'pass'" class="pass-banner" data-testid="bundle-pass">
        ✓ 全部 {{ connections.length }} 条连线符合预期，整束核验通过
      </div>
      <ul v-if="bundle.status === 'complete_with_errors'" class="wrong-list" data-testid="wrong-list">
        <li v-for="item in bundle.adjudications.filter((i) => i.verdict === 'wrong')" :key="item.connection.id">
          {{ item.message }} —— 删除红线后把 {{ item.connection.aPin }} 补接到 {{ item.expectedB }}
        </li>
      </ul>
      <p class="hint">
        已连接 {{ connections.length }} / {{ aPins.length }} 条；删除错线后两端立即恢复空闲，可直接补接，其余正确连线不会丢失。
      </p>
    </section>
  </div>
</template>

<style scoped>
.board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hint {
  color: var(--muted);
  font-size: 13px;
  margin: 8px 0;
}

kbd {
  background: #eef1f5;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0 5px;
  font-size: 12px;
}

.expected-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin: 10px 0 6px;
}

.strip-label {
  color: var(--muted);
  font-size: 12px;
}

.expected-chip {
  font-size: 12px;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  border-radius: 999px;
  padding: 2px 10px;
  color: #3730a3;
}

.legend {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 8px;
}

.swatch {
  display: inline-block;
  width: 22px;
  height: 4px;
  border-radius: 2px;
  vertical-align: middle;
  margin-right: 5px;
}

.swatch.correct {
  background: var(--neutral-wire);
}
.swatch.wrong {
  background: var(--error);
}
.swatch.free {
  background: var(--neutral-wire);
  height: 10px;
  width: 10px;
  border-radius: 50%;
}

.board {
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background:
    linear-gradient(#f8fafc, #f8fafc) 0 0 / 100% 100% no-repeat,
    repeating-linear-gradient(to bottom, transparent 0 67px, #eef1f5 67px 68px);
  touch-action: none;
  user-select: none;
}

.wire {
  stroke-width: 2.5;
  pointer-events: stroke;
}

.wire.correct {
  stroke: var(--neutral-wire);
}

.wire.wrong {
  stroke: var(--error);
  stroke-width: 3.5;
}

.drag-preview {
  stroke: var(--accent);
  stroke-width: 2;
  stroke-dasharray: 6 5;
  pointer-events: none;
}

.endpoint {
  cursor: pointer;
}

.pin-circle {
  fill: #ffffff;
  stroke: var(--neutral-wire);
  stroke-width: 2.5;
  transition:
    fill 0.15s,
    stroke 0.15s;
}

.endpoint.occupied .pin-circle {
  fill: var(--neutral-wire);
}

.endpoint.occupied .pin-circle.wrong {
  fill: var(--error);
  stroke: var(--error);
}

.endpoint.selected .pin-circle {
  stroke: var(--accent);
  stroke-width: 4;
}

.endpoint:focus .hit-area {
  fill: rgba(37, 99, 235, 0.08);
}

.pin-name {
  font-size: 14px;
  font-weight: 700;
  fill: var(--ink);
}

.pin-sub {
  font-size: 11px;
  fill: var(--muted);
}

.wrong-text {
  fill: var(--error);
  font-weight: 700;
}

.endpoint-error {
  font-size: 12px;
  font-weight: 600;
  fill: var(--error);
  paint-order: stroke;
  stroke: #fff;
  stroke-width: 4px;
  stroke-linejoin: round;
}

.wire-label-text {
  font-size: 12px;
  font-weight: 700;
  fill: #991b1b;
}

.wire-delete {
  cursor: pointer;
  outline: none;
}

.del-circle {
  stroke: var(--neutral-wire);
  stroke-width: 1.5;
}

.del-circle.wrong {
  stroke: var(--error);
}

.wire-delete:hover .del-circle,
.wire-delete:focus .del-circle {
  fill: var(--error);
}

.wire-delete:hover .del-text,
.wire-delete:focus .del-text {
  fill: #fff;
}

.del-text {
  font-size: 15px;
  font-weight: 700;
  fill: var(--error);
  dominant-baseline: central;
  pointer-events: none;
}

.alert.info {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1e40af;
}

.pass-banner {
  margin-top: 10px;
  background: var(--ok-bg);
  border: 1px solid #86efac;
  color: var(--ok);
  border-radius: 8px;
  padding: 10px 14px;
  font-weight: 700;
}

.wrong-list {
  margin: 10px 0 0;
  padding-left: 20px;
  color: #991b1b;
  font-size: 13px;
}

.wrong-list li {
  margin: 4px 0;
}
</style>
