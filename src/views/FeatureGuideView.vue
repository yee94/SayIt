<script setup lang="ts">
import {
  Mic,
  PenLine,
  Keyboard,
  ToggleLeft,
  Zap,
  Sparkles,
  BookOpen,
  History,
} from "lucide-vue-next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useI18n } from "vue-i18n";
import { markRaw } from "vue";

const { t } = useI18n();

const featureList = [
  { key: "voiceInput", icon: markRaw(Mic), hasSteps: true },
  { key: "editSelection", icon: markRaw(PenLine), hasSteps: true },
  { key: "hotkey", icon: markRaw(Keyboard), hasSteps: false },
  { key: "triggerMode", icon: markRaw(ToggleLeft), hasSteps: false },
  { key: "quickModeSwitch", icon: markRaw(Zap), hasSteps: false },
  { key: "promptMode", icon: markRaw(Sparkles), hasSteps: false },
  { key: "dictionary", icon: markRaw(BookOpen), hasSteps: false },
  { key: "history", icon: markRaw(History), hasSteps: false },
];
</script>

<template>
  <div class="app-page space-y-3 text-foreground">
    <p class="text-sm text-muted-foreground">
      {{ t("featureGuide.subtitle") }}
    </p>

    <Card v-for="feature in featureList" :key="feature.key">
      <CardHeader class="border-b border-border py-3">
        <CardTitle class="text-base flex items-center gap-2">
          <component :is="feature.icon" class="size-4 text-muted-foreground" />
          {{ t(`featureGuide.${feature.key}.title`) }}
        </CardTitle>
      </CardHeader>
      <CardContent class="pt-3 pb-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ t(`featureGuide.${feature.key}.description`) }}
        </p>
        <p
          v-if="feature.hasSteps"
          class="mt-2 text-sm text-muted-foreground leading-relaxed"
        >
          {{ t(`featureGuide.${feature.key}.steps`) }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>
