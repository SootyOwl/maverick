/**
 * Strip ANSI escape sequences and control characters from untrusted text
 * to prevent terminal manipulation attacks from malicious message content.
 *
 * This strips:
 * - ASCII C0 control characters (except \t and \n which are benign)
 * - C1 control characters (U+0080–U+009F) — 8-bit CSI (\x9b), OSC (\x9d),
 *   DCS (\x90), etc. Some terminals interpret these as escape sequences even
 *   in UTF-8 mode.
 * - 7-bit ANSI CSI escape sequences (e.g., \x1b[31m for colors, cursor movement)
 * - 7-bit ANSI OSC escape sequences (e.g., terminal title changes, hyperlinks)
 * - Other 7-bit escape sequences (\x1bP DCS, \x1b_ APC, \x1b^ PM)
 */
export function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u0080-\u009f]|\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(\x07|\x1b\\)|\x1b[P_^].*?(\x1b\\|\x07)/g, "");
}
