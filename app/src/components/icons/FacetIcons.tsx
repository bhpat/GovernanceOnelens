import type { SVGProps } from 'react';

/**
 * OneLens governance facet glyphs — bespoke, minimal line icons authored to a
 * consistent 20px grid (1.5 stroke, round joins, `currentColor`) so they theme
 * cleanly inside Fluent buttons/menus. Created because neither the Fabric item
 * set nor stock icons cover these governance-facet concepts crisply.
 */
function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Funnel — the filter bar affordance. */
export const FilterGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <path d="M3.5 4.75h13l-5 6v4.75l-3-1.5v-3.25z" />
  </Glyph>
);

/** Rosette / seal — endorsement (certified / promoted). */
export const EndorsementGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <circle cx="10" cy="7.5" r="4" />
    <path d="M8 11 6.8 17 10 15.1 13.2 17 12 11" />
  </Glyph>
);

/** Shield — sensitivity / classification. */
export const SensitivityGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <path d="M10 3 16 5v5c0 3.4-2.6 5.9-6 7-3.4-1.1-6-3.6-6-7V5z" />
  </Glyph>
);

/** Person — ownership. */
export const OwnerGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <circle cx="10" cy="7" r="3" />
    <path d="M4.5 16c0-3.1 2.6-4.7 5.5-4.7s5.5 1.6 5.5 4.7" />
  </Glyph>
);

/** Document with lines — documentation coverage. */
export const DocumentationGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <rect x="5" y="3" width="10" height="14" rx="1.5" />
    <path d="M7.5 7h5M7.5 10h5M7.5 13h3" />
  </Glyph>
);

/** Hexagon boundary — governance domain. */
export const DomainGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <path d="M10 3 16 6.5v7L10 17 4 13.5v-7z" />
  </Glyph>
);
