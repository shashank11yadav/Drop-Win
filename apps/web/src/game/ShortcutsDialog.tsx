import type { Ref } from 'react';

const SHORTCUTS: [string, string][] = [
  ['Space', 'Drop a ball'],
  ['D', 'Double the bet'],
  ['H', 'Halve the bet'],
  ['M', 'Sound on or off'],
  ['?', 'Show this list'],
];

export function ShortcutsDialog({ ref }: { ref: Ref<HTMLDialogElement> }) {
  return (
    <dialog ref={ref} aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <table>
        <tbody>
          {SHORTCUTS.map(([key, action]) => (
            <tr key={key}>
              <td>
                <kbd>{key}</kbd>
              </td>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Shortcuts are ignored while you are typing in a field.</p>
      <form method="dialog">
        <button className="button" type="submit" autoFocus>
          Close
        </button>
      </form>
    </dialog>
  );
}
