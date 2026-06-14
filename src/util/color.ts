// Tiny zero-dependency ANSI helper. Respects NO_COLOR and non-TTY output.

const ESC = String.fromCharCode(27); // \x1b

const enabled =
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb" &&
  (process.stdout.isTTY ?? false);

function wrap(open: number, close: number) {
  return (s: string): string =>
    enabled ? `${ESC}[${open}m${s}${ESC}[${close}m` : s;
}

export const color = {
  enabled,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};
