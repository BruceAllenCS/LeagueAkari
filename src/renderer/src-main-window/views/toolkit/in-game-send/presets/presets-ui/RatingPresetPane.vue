<template>
  <div class="flex flex-col pt-2">
    <div class="text-xs leading-relaxed text-black/60 dark:text-white/70">
      {{ t('description') }}
    </div>

    <PresetSendControls :preset="ratingPreset" :preset-label="presetLabel" />
    <PreviewPanel :preset="ratingPreset" />

    <NameDisplayStrategySelector
      :value="options.nameDisplayStrategy"
      @update:value="updateNameDisplayStrategy"
    />

    <PlayerSelectionPanel :selection="ratingPreset.playerSelection" />
  </div>
</template>

<script setup lang="ts">
import type { InGameSendPresetNameDisplayStrategy } from '@shared/shards/in-game-send'
import { useTranslation } from 'i18next-vue'
import { computed } from 'vue'

import { useRatingPreset } from '../data/rating'
import NameDisplayStrategySelector from '../widgets/NameDisplayStrategySelector.vue'
import PlayerSelectionPanel from '../widgets/PlayerSelectionPanel.vue'
import PresetSendControls from '../widgets/PresetSendControls.vue'
import PreviewPanel from '../widgets/PreviewPanel.vue'

const ratingPreset = useRatingPreset()

const { options, updateOptions } = ratingPreset
const { t } = useTranslation('renderer', { keyPrefix: 'toolkit.inGameSend.presets.rating' })

const presetLabel = computed(() => t('label'))

const updateNameDisplayStrategy = (value: InGameSendPresetNameDisplayStrategy) => {
  void updateOptions({
    nameDisplayStrategy: value
  })
}
</script>
