import type { ReactNode, SVGProps } from 'react';

const paths: Record<string, ReactNode> = {
  cube: (
    <>
      <path d="M12 2.8 20 7v10l-8 4.2L4 17V7z" />
      <path d="M4 7l8 4.2L20 7M12 11.2v10" />
    </>
  ),
  play: <path d="M7 5v14l11-7z" />,
  pause: <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />,
  prev: <path d="M15 5 8 12l7 7" />,
  next: <path d="m9 5 7 7-7 7" />,
  undo: <path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  reset: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />,
  share: <path d="M8 12h8M12 8l4 4-4 4M4 4h7M4 4v16h16v-7" />,
  save: <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />,
  open: <path d="M4 6h6l2 2h8v10H4zM4 10h16" />,
  image: <path d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15.5 9a1 1 0 1 0 0-.01" />,
  print: <path d="M7 8V4h10v4M6 17H4v-7h16v7h-2M7 14h10v6H7z" />,
  help: (
    <path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.4-1.5 1.1-1.5 2.1M12 17.5v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" />
  ),
  dice: <path d="M5 5h14v14H5zM9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01" />,
  book: <path d="M5 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5zM19 4h-6M19 4v14h-6" />,
  pointer: <path d="M6 3l12 8-5.5 1.5L10 18z" />,
  eye: (
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5" />
  ),
  check: <path d="m5 12 4.5 4.5L19 7" />,
  cross: <path d="M6 6l12 12M18 6 6 18" />,
  rotate: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  target: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8" />,
};

export function Icon({
  name,
  size = 16,
  ...rest
}: { name: keyof typeof paths | string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

/** Логотип: куб с секущей плоскостью. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 28 9.5v13L16 29 4 22.5v-13z" fill="none" stroke="#7f8896" strokeWidth="1.6" />
      <path
        d="M4 9.5 16 16l12-6.5M16 16v13"
        fill="none"
        stroke="#7f8896"
        strokeWidth="1.2"
        strokeDasharray="2 2"
      />
      <path
        d="M4 15.5 16 8l12 7.5-12 6.8z"
        fill="rgba(242,169,59,0.35)"
        stroke="#f2a93b"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
