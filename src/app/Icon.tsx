import type { CSSProperties } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  Ellipsis,
  FileText,
  Folder,
  GitBranch,
  LayoutGrid,
  Monitor,
  Moon,
  Network,
  Plus,
  RefreshCw,
  RotateCcwClock,
  Search,
  Sparkles,
  Sun,
  SunMoon,
  Terminal,
  X,
} from 'lucide-react';

// The application names icons by role. Lucide supplies the drawings, so a new
// icon is a named import here instead of another hand-written path.
const icons = {
  terminal: Terminal,
  branch: GitBranch,
  history: RotateCcwClock,
  chevron: ChevronRight,
  folder: Folder,
  file: FileText,
  cloud: Cloud,
  book: BookOpen,
  schema: Network,
  plus: Plus,
  more: Ellipsis,
  refresh: RefreshCw,
  search: Search,
  sparkles: Sparkles,
  close: X,
  arrow: ArrowRight,
  check: Check,
  grid: LayoutGrid,
  appearance: SunMoon,
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;

export function Icon({
  name,
  size = 16,
  className = '',
  style,
}: {
  name: keyof typeof icons;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Glyph = icons[name];
  return (
    <Glyph
      className={`ui-icon ${className}`}
      width={size}
      height={size}
      strokeWidth={1.6}
      aria-hidden="true"
      focusable="false"
      style={style}
    />
  );
}
