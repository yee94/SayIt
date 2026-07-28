<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useHistoryStore } from "../stores/useHistoryStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import {
  listenToEvent,
  TRANSCRIPTION_COMPLETED,
} from "../composables/useTauriEvents";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDurationFromMs,
  formatNumber,
} from "../lib/formatUtils";
import {
  findLlmModelConfig,
  findWhisperModelConfig,
} from "../lib/modelRegistry";
import DashboardUsageChart from "../components/DashboardUsageChart.vue";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { captureError } from "../lib/sentry";

const { t } = useI18n();
const historyStore = useHistoryStore();
const settingsStore = useSettingsStore();
const router = useRouter();

// Doubao ASR / 自订 LLM 皆无内建免费额度表，Dashboard 改显示今日实际用量。
const isPaidWhisperProvider = computed(() => true);

const isPaidLlmProvider = computed(() => true);

const hasAnyPaidProvider = computed(
  () => isPaidWhisperProvider.value || isPaidLlmProvider.value,
);

// Gemini 免费额度已不公开（依帐号浮动、仅能在 AI Studio 查询）：
// registry 将其 freeQuotaRpd 设 0 → 额度条自动略过，改以「今日用量」呈现
const isQuotaHiddenLlmProvider = computed(() => {
  if (isPaidLlmProvider.value) return false;
  const lConfig = findLlmModelConfig(settingsStore.selectedLlmModelId);
  return (lConfig?.freeQuotaRpd ?? 0) === 0;
});

const quotaDimensionList = computed(() => {
  const usage = historyStore.dashboardStats.dailyQuotaUsage;
  const dimensionList: { remaining: number; label: string }[] = [];

  // 免费 Whisper（Groq）才显示额度维度；limit 为 0 的维度略过避免误导
  if (!isPaidWhisperProvider.value) {
    const wConfig = findWhisperModelConfig(settingsStore.selectedWhisperModelId);
    const wRpdLimit = wConfig?.freeQuotaRpd ?? 2000;
    const wAudioLimitMs =
      (wConfig?.freeQuotaAudioSecondsPerDay ?? 28800) * 1000;
    if (wRpdLimit > 0) {
      dimensionList.push({
        remaining: 1 - usage.whisperRequestCount / wRpdLimit,
        label: t("dashboard.quotaWhisperRequests", { used: usage.whisperRequestCount, limit: formatNumber(wRpdLimit) }),
      });
    }
    if (wAudioLimitMs > 0) {
      dimensionList.push({
        remaining: 1 - usage.whisperBilledAudioMs / wAudioLimitMs,
        label: t("dashboard.quotaAudio", { used: formatDurationFromMs(usage.whisperBilledAudioMs), limit: formatDurationFromMs(wAudioLimitMs) }),
      });
    }
  }

  // 免费 LLM（Groq/Gemini）才显示额度维度
  if (!isPaidLlmProvider.value) {
    const lConfig = findLlmModelConfig(settingsStore.selectedLlmModelId);
    const lRpdLimit = lConfig?.freeQuotaRpd ?? 1000;
    const lTpdLimit = lConfig?.freeQuotaTpd ?? 100_000;
    if (lRpdLimit > 0) {
      dimensionList.push({
        remaining: 1 - usage.llmRequestCount / lRpdLimit,
        label: t("dashboard.quotaLlmRequests", { used: usage.llmRequestCount, limit: formatNumber(lRpdLimit) }),
      });
    }
    if (lTpdLimit > 0) {
      dimensionList.push({
        remaining: 1 - usage.llmTotalTokens / lTpdLimit,
        label: t("dashboard.quotaLlmTokens", { used: formatNumber(usage.llmTotalTokens), limit: formatNumber(lTpdLimit) }),
      });
    }
  }

  return dimensionList;
});

const hasFreeQuota = computed(() => quotaDimensionList.value.length > 0);

// 计费方案（OpenAI/Anthropic）无免费额度，改显示今日实际用量
const paidUsageList = computed(() => {
  const usage = historyStore.dashboardStats.dailyQuotaUsage;
  const list: { label: string }[] = [];
  if (isPaidWhisperProvider.value) {
    list.push({
      label: t("dashboard.usageWhisper", {
        requests: formatNumber(usage.whisperRequestCount),
        audio: formatDurationFromMs(usage.whisperBilledAudioMs),
      }),
    });
  }
  if (isPaidLlmProvider.value || isQuotaHiddenLlmProvider.value) {
    list.push({
      label: t("dashboard.usageLlm", {
        requests: formatNumber(usage.llmRequestCount),
        tokens: formatNumber(usage.llmTotalTokens),
      }),
    });
  }
  return list;
});

const quotaRemainingPercent = computed(() => {
  if (quotaDimensionList.value.length === 0) return 0;
  const minRemaining = Math.min(...quotaDimensionList.value.map((d) => d.remaining));
  return Math.max(0, minRemaining);
});

const quotaBottleneckLabel = computed(() => {
  if (quotaDimensionList.value.length === 0) return "";
  const sorted = [...quotaDimensionList.value].sort((a, b) => a.remaining - b.remaining);
  return sorted[0].label;
});

const quotaBarColorClass = computed(() => {
  const pct = quotaRemainingPercent.value;
  if (pct >= 0.5) return "bg-emerald-500";
  if (pct >= 0.2) return "bg-amber-500";
  return "bg-destructive";
});

let unlistenTranscriptionCompleted: UnlistenFn | null = null;

function navigateToHistory() {
  void router.push("/history");
}

onMounted(async () => {
  try {
    await historyStore.refreshDashboard();
  } catch (err) {
    captureError(err, { source: "dashboard-view-mount" });
  }

  unlistenTranscriptionCompleted = await listenToEvent(
    TRANSCRIPTION_COMPLETED,
    () => {
      void historyStore.refreshDashboard();
    },
  );
});

onBeforeUnmount(() => {
  unlistenTranscriptionCompleted?.();
});
</script>

<template>
  <div class="app-page">
    <!-- 统计卡片 -->
    <div class="grid grid-cols-3 gap-3">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>{{ $t("dashboard.totalRecordingTime") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatDurationFromMs(historyStore.dashboardStats.totalRecordingDurationMs) }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>{{ $t("dashboard.totalCharacters") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatNumber(historyStore.dashboardStats.totalCharacters) }} {{ $t("dashboard.characterUnit") }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>{{ $t("dashboard.timeSaved") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatDurationFromMs(historyStore.dashboardStats.estimatedTimeSavedMs) }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>{{ $t("dashboard.totalTranscriptions") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatNumber(historyStore.dashboardStats.totalTranscriptions) }} {{ $t("dashboard.transcriptionUnit") }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>{{ $t("dashboard.avgCharacters") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ historyStore.dashboardStats.totalTranscriptions > 0 ? formatNumber(Math.round(historyStore.dashboardStats.totalCharacters / historyStore.dashboardStats.totalTranscriptions)) : 0 }} {{ $t("dashboard.characterUnit") }}
          </p>
        </CardContent>
      </Card>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Card class="cursor-default">
              <CardHeader class="pb-2">
                <div class="flex items-center justify-between gap-2">
                  <CardDescription>{{ hasFreeQuota ? $t("dashboard.dailyQuota") : $t("dashboard.dailyUsage") }}</CardDescription>
                  <Badge v-if="hasAnyPaidProvider" variant="secondary">{{ $t("dashboard.billedPlan") }}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <!-- 免费额度（免费服务）-->
                <template v-if="hasFreeQuota">
                  <p class="text-2xl font-bold text-foreground">
                    {{ Math.round(quotaRemainingPercent * 100) }}%
                  </p>
                  <div class="mt-2 h-1.5 w-full rounded-full bg-muted">
                    <div
                      class="h-full rounded-full transition-all"
                      :class="quotaBarColorClass"
                      :style="{ width: `${Math.round(quotaRemainingPercent * 100)}%` }"
                    />
                  </div>
                  <p class="text-xs text-muted-foreground mt-1.5 truncate">
                    {{ quotaBottleneckLabel }}
                  </p>
                </template>

                <!-- 付费服务今日用量（混用与全付费共用同一段；混用为次要样式 + 分隔线）-->
                <div
                  v-if="paidUsageList.length > 0"
                  class="space-y-1"
                  :class="hasFreeQuota ? 'mt-1.5 pt-1.5 border-t border-border' : ''"
                >
                  <p
                    v-for="(item, idx) in paidUsageList"
                    :key="idx"
                    :class="hasFreeQuota ? 'text-xs text-muted-foreground' : 'text-sm font-medium text-foreground'"
                  >
                    {{ item.label }}
                  </p>
                </div>

                <!-- 全付费提示（混用不显示，避免与免费额度 % 矛盾）-->
                <p
                  v-if="!hasFreeQuota && paidUsageList.length > 0"
                  class="text-xs text-muted-foreground mt-1.5"
                >
                  {{ $t("dashboard.billedNoFreeQuota") }}
                </p>
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent class="w-72 p-3 bg-card text-card-foreground border border-border" side="bottom" :side-offset="6" hide-arrow>
            <p class="text-xs font-medium mb-2">{{ hasFreeQuota ? $t("dashboard.dailyQuotaDetail") : $t("dashboard.dailyUsage") }}</p>
            <div v-if="hasFreeQuota" class="space-y-2">
              <div v-for="(dim, idx) in quotaDimensionList" :key="idx">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-muted-foreground">{{ dim.label }}</span>
                  <span class="font-medium">{{ Math.round(Math.max(0, dim.remaining) * 100) }}%</span>
                </div>
                <div class="mt-0.5 h-1 w-full rounded-full bg-muted">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="quotaBarColorClass"
                    :style="{ width: `${Math.round(Math.max(0, dim.remaining) * 100)}%` }"
                  />
                </div>
              </div>
            </div>
            <div
              v-if="isQuotaHiddenLlmProvider"
              class="mt-2 pt-2 border-t border-border"
            >
              <span class="text-xs text-muted-foreground">
                {{ $t("dashboard.geminiQuotaHint") }}
              </span>
            </div>
            <div
              v-if="paidUsageList.length > 0"
              class="space-y-1"
              :class="{ 'mt-2 pt-2 border-t border-border': hasFreeQuota }"
            >
              <div
                v-for="(item, idx) in paidUsageList"
                :key="`paid-${idx}`"
                class="text-xs text-muted-foreground"
              >
                {{ item.label }}
              </div>
              <p class="text-xs text-muted-foreground">{{ $t("dashboard.billedNoFreeQuota") }}</p>
            </div>
            <div
              v-if="historyStore.dashboardStats.dailyQuotaUsage.vocabularyAnalysisRequestCount > 0"
              class="mt-2 pt-2 border-t border-border"
            >
              <span class="text-xs text-muted-foreground">
                {{ $t("dashboard.vocabularyAnalysisUsage", {
                  requests: historyStore.dashboardStats.dailyQuotaUsage.vocabularyAnalysisRequestCount,
                  tokens: formatNumber(historyStore.dashboardStats.dailyQuotaUsage.vocabularyAnalysisTotalTokens),
                }) }}
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <!-- 每日使用趋势图表 -->
    <Card class="mt-4">
      <CardHeader>
        <CardTitle class="text-base">{{ $t("dashboard.usageTrend") }}</CardTitle>
        <CardDescription>{{ $t("dashboard.lastNDays", { days: historyStore.usageTrendDays }) }}</CardDescription>
      </CardHeader>
      <CardContent>
        <DashboardUsageChart :data="historyStore.dailyUsageTrendList" />
      </CardContent>
    </Card>

    <!-- 最近转录 -->
    <Card class="mt-4">
      <CardHeader class="flex-row items-center justify-between">
        <CardTitle class="text-base">{{ $t("dashboard.recentTranscriptions") }}</CardTitle>
        <Button
          v-if="historyStore.recentTranscriptionList.length > 0"
          variant="link"
          @click="navigateToHistory"
        >
          {{ $t("dashboard.viewAll") }}
        </Button>
      </CardHeader>
      <CardContent>
        <!-- 空状态 -->
        <div
          v-if="historyStore.recentTranscriptionList.length === 0"
          class="rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground"
        >
          {{ $t("dashboard.emptyState") }}
        </div>

        <!-- 最近列表 -->
        <div v-else class="space-y-2">
          <Button
            v-for="record in historyStore.recentTranscriptionList"
            :key="record.id"
            variant="ghost"
            class="w-full h-auto rounded-lg border border-border px-4 py-3 text-left flex flex-col items-start"
            @click="navigateToHistory"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="text-xs text-muted-foreground">
                {{ formatTimestamp(record.timestamp) }}
              </span>
              <Badge
                v-if="record.wasEnhanced"
                class="bg-emerald-500/20 text-emerald-400 border-0"
              >
                {{ $t("dashboard.aiEnhanced") }}
              </Badge>
            </div>
            <p class="mt-1 text-sm text-muted-foreground truncate w-full">
              {{ truncateText(getDisplayText(record)) }}
            </p>
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
