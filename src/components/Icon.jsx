const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  operations: <><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6l-2.4 2.4-2.3-2.3a4 4 0 0 0 5 5l7.4 7.4a2 2 0 0 1-2.8 2.8l-7.4-7.4" /><path d="m5.5 13.5-3 3a2.1 2.1 0 0 0 3 3l3-3" /></>,
  billing: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 7h6M9 11h6M9 15h3" /></>,
  substation: <><path d="m13 2-8 12h7l-1 8 8-12h-7Z" /></>,
  patrol: <><path d="M9 5 7 3H5l-2 7v8h6v-7h6v7h6v-8l-2-7h-2l-2 2" /><circle cx="6" cy="14" r="3" /><circle cx="18" cy="14" r="3" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  'chevron-left': <><path d="m15 18-6-6 6-6" /></>,
  'chevron-right': <><path d="m9 18 6-6-6-6" /></>,
  'arrow-left': <><path d="m12 19-7-7 7-7M5 12h14" /></>,
  'arrow-right': <><path d="m12 5 7 7-7 7M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
  'alert-triangle': <><path d="M10.3 3.7 2.4 17.4A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.6L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  'x-circle': <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  loader: <><path d="M21 12a9 9 0 1 1-6.2-8.6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" /></>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  check: <><path d="M5 12.5 9.5 17 19 7" /></>,
  'chart-bar': <><path d="M4 20V10" /><path d="M10 20V6" /><path d="M16 20v-8" /><path d="M4 20h16" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M15 13h4v3h-4z" /></>,
  'trend-up': <><path d="M3 17 9 11l4 4 5-8" /><path d="M14 7h5v5" /></>,
  'pie-chart': <><path d="M12 3a9 9 0 1 0 9 9H12z" /><path d="M12 12 21 12A9 9 0 0 0 12 3z" /></>,
  filter: <><path d="M3 6h18l-7 7v5l-4 2v-7L3 6z" /></>,
  calendar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
  download: <><path d="M12 3v13" /><path d="m7 10 5 5 5-5" /><path d="M3 17h18" /></>,
  layers: <><path d="M12 2 3 7l9 5 9-5-9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 17l9 5 9-5" /></>,
  shield: <><path d="M12 2 4 5v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V5L12 2z" /><path d="m9 12 2 2 4-4" /></>,
}

export default function Icon({ name, size = 18, className = '' }) {
  return (
    <svg
      className={`ui-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name] ?? ICONS.dashboard}
    </svg>
  )
}
