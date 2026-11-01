const MiB = 1024 * 1024
export const WEB_PACKAGE_BYTES = 128 * MiB
export const WEB_SOURCE_BYTES = 8 * MiB
export const WEB_SOURCE_TOTAL_BYTES = 32 * MiB
export const WEB_SOURCE_FILES = 128
export const WEB_RESOURCE_BYTES = 96 * MiB
// Drafts include both the current content and each mode's saved content.
// Browser storage can impose a lower quota; the workbench reports save failures.
export const TOOL_WORKSPACE_MAX_CHARS = 128 * MiB
