import type { SVGProps } from 'react';

/** Line icons drawn with `currentColor`; always decorative, the control carries the name. */
function Icon({ size = 20, children, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const MenuIcon = () => (
  <Icon>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const GamepadIcon = () => (
  <Icon size={30} strokeWidth={1.8}>
    <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01" />
    <path d="M17.3 5H6.7a4 4 0 0 0-3.96 3.43l-.73 5.1A3 3 0 0 0 7 16.2L9 14h6l2 2.2a3 3 0 0 0 4.99-2.67l-.73-5.1A4 4 0 0 0 17.3 5z" />
  </Icon>
);

export const SyncIcon = () => (
  <Icon size={18}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon size={16}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const GridIcon = () => (
  <Icon size={16} strokeLinecap="butt" strokeLinejoin="miter">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </Icon>
);

export const ListIcon = () => (
  <Icon size={16}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
);

export const CloseIcon = ({ size = 12 }: { size?: number }) => (
  <Icon size={size} strokeWidth={2.5}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
