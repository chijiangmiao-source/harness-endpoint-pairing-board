<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { parsePinList, validateMapping, type MappingSnapshot } from '../wiring/verification'

const emit = defineEmits<{
  enter: [snapshot: MappingSnapshot]
}>()

const aText = ref('')
const bText = ref('')
const targets = reactive<Record<string, string>>({})

const aRaw = computed(() => parsePinList(aText.value))
const bRaw = computed(() => parsePinList(bText.value))
const aPins = computed(() => [...new Set(aRaw.value)])
const bPins = computed(() => [...new Set(bRaw.value)])

const validation = computed(() => validateMapping(aRaw.value, bRaw.value, targets))

function defectsFor(side: 'A' | 'B', pin: string): string[] {
  return validation.value.defects
    .filter((d) => (side === 'A' ? d.aPin === pin : d.bPin === pin))
    .map((d) => d.message)
}

function loadExample() {
  aText.value = ['A1', 'A2', 'A3', 'A4'].join('\n')
  bText.value = ['B1', 'B2', 'B3', 'B4'].join('\n')
  for (const key of Object.keys(targets)) delete targets[key]
  Object.assign(targets, { A1: 'B3', A2: 'B1', A3: 'B4', A4: 'B2' })
}

function enterStage() {
  if (!validation.value.valid) return
  emit('enter', {
    aPins: validation.value.aPins,
    bPins: validation.value.bPins,
    expectedByA: new Map(validation.value.expectedByA),
  })
}
</script>

<template>
  <div>
    <section class="panel">
      <h2>① 录入 A 端针位号（每行一个，必须唯一）</h2>
      <textarea
        v-model="aText"
        rows="7"
        spellcheck="false"
        data-testid="pins-a"
        placeholder="A1&#10;A2&#10;A3"
      ></textarea>
      <p class="hint">已录入 {{ aRaw.length }} 行，去重后 {{ aPins.length }} 个针位。</p>
    </section>

    <section class="panel">
      <h2>② 录入 B 端针位号（每行一个，必须唯一）</h2>
      <textarea
        v-model="bText"
        rows="7"
        spellcheck="false"
        data-testid="pins-b"
        placeholder="B1&#10;B2&#10;B3"
      ></textarea>
      <p class="hint">已录入 {{ bRaw.length }} 行，去重后 {{ bPins.length }} 个针位。</p>

      <ul v-if="bPins.length" class="pin-feedback">
        <li v-for="pin in bPins" :key="pin">
          <span class="pin-chip">B 端 · {{ pin }}</span>
          <p
            v-for="(msg, i) in defectsFor('B', pin)"
            :key="i"
            class="error-text"
            :data-testid="`b-error-${pin}`"
          >
            {{ msg }}
          </p>
        </li>
      </ul>
    </section>

    <section class="panel">
      <h2>③ 为每个 A 端针位指定唯一的预期 B 端针位</h2>
      <p class="hint">
        两侧外壳方向相反，核验只认针位号：每个 A 端针位都必须指向一个存在的 B
        端针位，且不能两个 A 端指向同一个 B 端。
      </p>

      <table v-if="aPins.length" class="mapping-table">
        <thead>
          <tr>
            <th>A 端针位</th>
            <th>预期连接到的 B 端针位</th>
            <th>问题反馈</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="pin in aPins" :key="pin">
            <td class="pin-cell">A 端 · {{ pin }}</td>
            <td>
              <select
                v-model="targets[pin]"
                :data-a-pin="pin"
                :data-testid="`target-${pin}`"
              >
                <option value="" disabled>— 请选择预期 B 端针位 —</option>
                <option v-for="b in bPins" :key="b" :value="b">{{ b }}</option>
              </select>
            </td>
            <td>
              <p
                v-for="(msg, i) in defectsFor('A', pin)"
                :key="i"
                class="error-text"
                :data-testid="`a-error-${pin}`"
              >
                {{ msg }}
              </p>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint">请先在上方录入 A 端针位。</p>
    </section>

    <section class="panel">
      <h2>④ 录入校验结果</h2>
      <div v-if="validation.valid" class="alert ok" data-testid="mapping-summary">
        映射成立：{{ aPins.length }} 对针位严格一一对应，可以进入连线阶段。
      </div>
      <div v-else class="alert error" data-testid="mapping-summary">
        <template v-if="validation.defects.length">
          当前有 {{ validation.defects.length }} 条录入问题，已全部标注在对应针位旁，修复前不能进入连线阶段：
          <ul class="summary-list">
            <li v-for="(d, i) in validation.defects" :key="i">{{ d.message }}</li>
          </ul>
        </template>
      </div>

      <div class="actions">
        <button type="button" @click="loadExample" data-testid="load-example">
          填入示例数据（交叉关系）
        </button>
        <button
          type="button"
          class="primary"
          :disabled="!validation.valid"
          data-testid="enter-stage"
          :title="validation.valid ? '进入连线阶段' : '请先修复所有录入问题'"
          @click="enterStage"
        >
          进入连线阶段
        </button>
      </div>
      <p v-if="!validation.valid && (aRaw.length || bRaw.length)" class="hint">
        按钮已禁用：仍有针位重复、预期端缺失、预期端被多个 A 端指向或未覆盖全部针位的问题。
      </p>
    </section>
  </div>
</template>

<style scoped>
.hint {
  color: var(--muted);
  font-size: 12px;
  margin: 8px 0 0;
}

.mapping-table {
  width: 100%;
  border-collapse: collapse;
}

.mapping-table th,
.mapping-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
  font-size: 14px;
}

.mapping-table th {
  color: var(--muted);
  font-weight: 600;
  font-size: 12px;
}

.pin-cell {
  white-space: nowrap;
  font-weight: 600;
}

.pin-feedback {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px 16px;
}

.pin-chip {
  font-weight: 600;
  font-size: 13px;
}

.summary-list {
  margin: 6px 0 0;
  padding-left: 18px;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 14px;
}
</style>
