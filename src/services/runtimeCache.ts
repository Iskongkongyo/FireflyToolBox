export type CacheReport = {
  disk_cache_cleared: boolean
  temporary_files: number
  temporary_bytes: number
  skipped_files: number
  memory_bytes: number
  warnings: string[]
}

export function cacheReportMessage(report: CacheReport, previewEntries = 0): string {
  const warnings = [...report.warnings]
  if (report.skipped_files) warnings.push(`${report.skipped_files} 项临时数据未能清理，可稍后重试`)
  if (!report.disk_cache_cleared && !report.warnings.length) warnings.push('当前平台未提供浏览器磁盘缓存清理')
  const details: string[] = []
  if (report.temporary_files) details.push(`${report.temporary_files} 个临时文件`)
  if (previewEntries) details.push(`${previewEntries} 项预览数据`)
  if (report.memory_bytes) details.push(`${(report.memory_bytes / 1024 / 1024).toFixed(1)} MiB 引擎缓存`)
  const summary = warnings.length ? '缓存已部分清理' : '缓存清理完成'
  return [summary + (details.length ? `（已清理 ${details.join('、')}）` : ''), ...warnings].join('；')
}
