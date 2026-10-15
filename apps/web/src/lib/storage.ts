// localStorage can throw (private mode, blocked storage), and a preference is
// never worth crashing over, so every access is guarded.

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(`drop-win:${key}`);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(`drop-win:${key}`, value);
  } catch {
    // Preference simply is not remembered.
  }
}
