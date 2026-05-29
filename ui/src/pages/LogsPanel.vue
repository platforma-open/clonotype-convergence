<script setup lang="ts">
import { PlLogView } from "@platforma-sdk/ui-vue";
import { useApp } from "../app";

const app = useApp();
</script>

<template>
  <PlLogView v-if="app.model.outputs.runLogs" :handle="app.model.outputs.runLogs" />
  <p v-else>Run the block to see logs.</p>
</template>
