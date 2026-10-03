export interface StackerShell {
  isOtherAudioPlaying(): boolean;
  bringToFront(): void;
  /** JSON string describing the device (model, SDK, WebView UA). */
  info(): string;
}

/** The Android TV shell's injected bridge, or null when running in a plain browser. */
export function getShell(w: unknown = globalThis): StackerShell | null {
  const shell = (w as { StackerShell?: Partial<StackerShell> } | null | undefined)?.StackerShell;
  if (
    shell &&
    typeof shell.isOtherAudioPlaying === 'function' &&
    typeof shell.bringToFront === 'function' &&
    typeof shell.info === 'function'
  ) {
    return shell as StackerShell;
  }
  return null;
}
