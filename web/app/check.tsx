/** Marca de "ok" das listas de garantias, na landing e no medidor. */
export function Check() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--acento-fraco)" />
      <path
        d="M6 10.2l2.6 2.6L14 7.4"
        fill="none"
        stroke="var(--acento)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
