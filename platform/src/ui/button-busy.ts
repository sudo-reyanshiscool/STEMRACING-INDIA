/** Temporary progress feedback. Restores the original label and enabled state on failure or completion. */
export function buttonBusy(button: HTMLButtonElement, label = 'Saving…'): () => void {
  const children = [...button.childNodes];
  const disabled = button.disabled;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.replaceChildren(label);
  return () => {
    button.replaceChildren(...children);
    button.removeAttribute('aria-busy');
    button.disabled = disabled;
  };
}
