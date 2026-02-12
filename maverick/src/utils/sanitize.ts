/**
 * Strip ANSI escape sequences and control characters from untrusted text
 * to prevent terminal manipulation attacks from malicious message content.
 *
 * This strips:
 * - ASCII control characters (except \t and \n which are benign)
 * - ANSI CSI escape sequences (e.g., \x1b[31m for colors, cursor movement)
 * - ANSI OSC escape sequences (e.g., terminal title changes, hyperlinks)
 */
export function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(\x07|\x1b\\)/g, "");
}
