// HTML keeps embedded CSS untouched; the separate CSS tool uses CSSO.
// Avoid bundling CleanCSS's HTTP/file import machinery into the offline Worker.
export default class CleanCSS { constructor(){throw new Error('HTML 内嵌 CSS 压缩未启用，请使用 CSS 工具。')} }
