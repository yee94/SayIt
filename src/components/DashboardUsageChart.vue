<script setup lang="ts">
import type { DailyUsageTrend } from "@/types/transcription";
import type { ChartConfig } from "@/components/ui/chart";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { VisArea, VisAxis, VisLine, VisXYContainer } from "@unovis/vue";
import {
  ChartContainer,
  ChartCrosshair,
  ChartTooltip,
  ChartTooltipContent,
  componentToString,
} from "@/components/ui/chart";

const props = defineProps<{ data: DailyUsageTrend[] }>();
const { t } = useI18n();

const chartConfig = computed(() => ({
  count: { label: t("dashboard.usageCount"), color: "var(--chart-1)" },
}) satisfies ChartConfig);

const svgDefs = `
  <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%" stop-color="var(--color-count)" stop-opacity="0.8" />
    <stop offset="95%" stop-color="var(--color-count)" stop-opacity="0.1" />
  </linearGradient>
`;

// date 为本地时间的 YYYY-MM-DD（与 store 补零、SQL 'localtime' 一致）。
// 必须用本地建构子解析；new Date("YYYY-MM-DD") 会以 UTC 解读，
// 在 UTC- 时区会让刻度标签/tooltip 显示前一天。
function parseLocalDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const xAccessor = (d: DailyUsageTrend) => parseLocalDateKey(d.date);
const yAccessor = [(d: DailyUsageTrend) => d.count];
const fillColor = () => "url(#fillCount)";
const lineColor = () => chartConfig.value.count.color;

// 在「补零后的完整区间」上均匀挑最多 7 个真实日期当刻度，
// 确保刻度落在实际资料点上，避免资料稀疏时 D3 在窄 domain 内塞出重复日期标签。
const xTickValues = computed<number[]>(() => {
  const data = props.data;
  if (data.length === 0) return [];
  const maxTicks = Math.min(data.length, 7);
  const indices = new Set<number>();
  if (maxTicks <= 1) {
    indices.add(0);
  } else {
    const step = (data.length - 1) / (maxTicks - 1);
    for (let i = 0; i < maxTicks; i++) {
      indices.add(Math.round(i * step));
    }
  }
  return Array.from(indices).map((i) =>
    parseLocalDateKey(data[i].date).getTime(),
  );
});

function formatDateLabel(d: number): string {
  const date = new Date(d);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}
</script>

<template>
  <div v-if="props.data.length === 0" class="rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
    {{ $t("dashboard.noRecords") }}
  </div>

  <ChartContainer v-else :config="chartConfig" class="aspect-auto h-[200px] w-full" :cursor="false">
    <VisXYContainer
      :data="props.data"
      :svg-defs="svgDefs"
      :margin="{ left: -40 }"
    >
      <VisArea
        :x="xAccessor"
        :y="yAccessor"
        :color="fillColor"
        :opacity="0.6"
      />
      <VisLine
        :x="xAccessor"
        :y="yAccessor"
        :color="lineColor"
        :line-width="1.5"
      />
      <VisAxis
        type="x"
        :x="xAccessor"
        :tick-line="false"
        :domain-line="false"
        :grid-line="false"
        :tick-values="xTickValues"
        :tick-text-hide-overlapping="true"
        :tick-format="formatDateLabel"
      />
      <VisAxis
        type="y"
        :num-ticks="3"
        :tick-line="false"
        :domain-line="false"
      />
      <ChartTooltip />
      <ChartCrosshair
        :template="componentToString(chartConfig, ChartTooltipContent, {
          labelFormatter: (d) => formatDateLabel(d as number),
        })"
        :color="() => chartConfig.count.color"
      />
    </VisXYContainer>
  </ChartContainer>
</template>
