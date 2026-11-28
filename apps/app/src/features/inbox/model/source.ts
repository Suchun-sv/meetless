import type { Translator } from '@meetless/i18n';

const RAW = new Set(['paste', 'file', 'camera', 'album', 'drop', 'share']);

/**
 * A material's source line as words. The server sends display text (「邮件」「12 条消息」「PDF 6 页」),
 * but for things the user added itself it may send how it came in (`paste`, `file`, `camera`,
 * `album`, `drop`, `share`): those become 粘贴 / 文件 / 拍照 / 相册 / 拖进来 / 分享.
 */
export function sourceLabel(t: Translator['t'], source: string): string {
  return RAW.has(source) ? t(`inb.src.${source as 'paste'}`) : source;
}
