// Brand mark — a constructed geometric "G" monogram (monoline grotesque,
// matched to the app's Geist display face). Crisp and flat in-app so it stays
// sharp at chip size and adapts to the theme-aware foreground; the dock icon
// carries the richer graphite material. Same letterform everywhere → one
// identity. Self-contained path (no font dependency for rasterized icons).
export function BrandGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path
        d="M18.5 8.2 A7.6 7.6 0 1 0 19.6 12 L13 12"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
