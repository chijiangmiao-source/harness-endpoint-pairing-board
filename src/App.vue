<script setup lang="ts">
import { ref } from 'vue'
import MappingEntry from './components/MappingEntry.vue'
import WiringBoard from './components/WiringBoard.vue'
import type { MappingSnapshot } from './wiring/verification'

const mapping = ref<MappingSnapshot | null>(null)

function enterBoard(snapshot: MappingSnapshot) {
  mapping.value = snapshot
}

function backToEntry() {
  mapping.value = null
}
</script>

<template>
  <header>
    <h1>线束针位连线核验板</h1>
    <p class="subtitle">
      两端外壳方向相反时，靠肉眼顺着相邻针位追线极易交叉错接。先录入两端针位与预期一一对应关系，
      再在板上建立实际连线：正确线显示中性色，错接线标红并指出预期对端。
    </p>
  </header>

  <MappingEntry v-if="!mapping" @enter="enterBoard" />
  <WiringBoard v-else :mapping="mapping" @back="backToEntry" />
</template>
