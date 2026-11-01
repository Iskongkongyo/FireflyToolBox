<script setup lang="ts">
defineProps<{ name: string; filled?: boolean }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'menu'"><path d="M4 6h16M4 12h16M4 18h16"/></template>
    <template v-else-if="name === 'download'"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></template>
    <template v-else-if="name === 'notification'"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></template>
    <template v-else-if="name === 'automation' || name === 'module-automation'"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><path d="M7 5h5a4 4 0 0 1 4 4v1M7 19h5a4 4 0 0 0 4-4v-1M7 12h5"/></template>
    <template v-else-if="name === 'more-vertical'"><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/></template>
    <template v-else-if="name === 'invert-selection'"><path d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4"/><path d="M7 17h10V7z" fill="currentColor" stroke="none"/></template>
    <template v-else-if="name === 'sync'"><path d="M20 7a8 8 0 0 0-13-3L3 8m0-5v5h5M4 17a8 8 0 0 0 13 3l4-4m0 5v-5h-5"/></template>
    <template v-else-if="name === 'edit'"><path d="m16 3 5 5L9 20l-6 1 1-6zM13.5 5.5l5 5" stroke-width="2.8"/></template>
    <template v-else-if="name === 'chevron-right'"><path d="m9 5 7 7-7 7"/></template>
    <template v-else-if="name === 'check'"><path d="m4 12 5 5L20 6"/></template>
    <template v-else-if="name === 'close'"><path d="M5 5 19 19M19 5 5 19"/></template>
    <template v-else-if="name === 'trash'"><path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6"/></template>
    <template v-else-if="name === 'home'"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></template>
    <template v-else-if="name === 'favorites'"><path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z" :fill="filled ? 'currentColor' : 'none'"/></template>
    <template v-else-if="name === 'websites'"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z"/></template>
    <template v-else-if="name === 'detect'"><path d="M4 9V5a1 1 0 0 1 1-1h4m6 0h4a1 1 0 0 1 1 1v4M4 15v4a1 1 0 0 0 1 1h4m6 0h4a1 1 0 0 0 1-1v-4M8 12h8"/></template>
    <template v-else-if="name === 'allTools'"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></template>
    <template v-else-if="name === 'groups'"><path d="M4 6h6m4 0h6M4 12h11m4 0h1M4 18h4m4 0h8"/><circle cx="12" cy="6" r="2"/><circle cx="17" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></template>
    <template v-else-if="name === 'shortcut'"><path d="M8 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 12 21 3m-7 0h7v7"/></template>
    <template v-else-if="name === 'module-code'"><path d="m8 6-5 6 5 6m8-12 5 6-5 6M14 4l-4 16"/></template>
    <template v-else-if="name === 'module-text'"><path d="M4 6h16M4 12h12M4 18h9"/></template>
    <template v-else-if="name === 'module-spark'"><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></template>
    <template v-else-if="name === 'module-shapes'"><rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="m7 14-5 8h10zm10 0 5 8H12z"/></template>
    <template v-else-if="name === 'module-bolt'"><path d="M13 2 4 13h7l-1 9 10-12h-7z"/></template>
    <template v-else-if="name === 'module-hash'"><path d="M9 3 6 21M18 3l-3 18M3 9h18M2 16h18"/></template>
    <template v-else-if="name === 'module-image'"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/></template>
    <template v-else-if="name === 'module-file'"><path d="M6 2h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM14 2v6h5M8 13h8M8 17h8"/></template>
    <template v-else-if="name === 'module-folder'"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></template>
    <template v-else-if="name === 'module-link'"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2"/></template>
    <template v-else-if="name === 'module-globe'"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z"/></template>
    <template v-else-if="name === 'module-search'"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></template>
    <template v-else-if="name === 'module-clock'"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></template>
    <template v-else-if="name === 'module-calendar'"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2"/></template>
    <template v-else-if="name === 'module-calculator'"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1M12 11h1M16 11h.01M8 15h1M12 15h1M16 15h.01M8 19h1M12 19h4"/></template>
    <template v-else-if="name === 'module-lock'"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></template>
    <template v-else-if="name === 'module-terminal'"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="m6 8 4 4-4 4m7 0h5"/></template>
    <template v-else-if="name === 'module-database'"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></template>
    <template v-else-if="name === 'module-chart'"><path d="M3 3v18h18M7 17v-5M12 17V7M17 17v-8"/></template>
    <template v-else-if="name === 'module-heart'"><path d="M20.8 8.2c0 4.4-8.8 11-8.8 11s-8.8-6.6-8.8-11a5 5 0 0 1 8.8-3.1 5 5 0 0 1 8.8 3.1z"/></template>
    <template v-else-if="name === 'theme'"><path d="M12 3a9 9 0 1 0 9 9c0-1.7-1.1-2.7-2.5-2.7h-2a1.5 1.5 0 0 1-1.5-1.5V5.5C15 4 14 3 12 3z"/><circle cx="6.8" cy="11" r=".8" fill="currentColor" stroke="none"/><circle cx="10" cy="7.4" r=".8" fill="currentColor" stroke="none"/><circle cx="7.5" cy="15.3" r=".8" fill="currentColor" stroke="none"/></template>
    <template v-else-if="name === 'settings'"><path d="M9.8 3h4.4l.6 2.2 1.6.9 2.2-.6 2.2 3.8-1.6 1.6v1.9l1.6 1.6-2.2 3.8-2.2-.6-1.6.9-.6 2.2H9.8l-.6-2.2-1.6-.9-2.2.6-2.2-3.8 1.6-1.6v-1.9L3.2 9.3l2.2-3.8 2.2.6 1.6-.9z"/><circle cx="12" cy="12" r="3"/></template>
    <template v-else-if="name === 'about'"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.7h.01"/></template>
  </svg>
</template>
