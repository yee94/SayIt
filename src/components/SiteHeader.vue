<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center gap-2 border-b border-border/80 bg-background/95 px-5 backdrop-blur"
  >
    <h1 class="text-base font-medium text-foreground">
      {{ title }}
    </h1>
  </header>
</template>
