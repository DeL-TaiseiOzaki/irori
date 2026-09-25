import type { CSSProperties } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  Cloud,
  CloudCog,
  CloudUpload,
  Code,
  Columns3,
  Download,
  Ellipsis,
  FileText,
  Flame,
  Folder,
  FolderOpen,
  GitBranch,
  House,
  Info,
  Layers,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Lock,
  Map,
  Minus,
  Monitor,
  Moon,
  Network,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcwClock,
  ScrollText,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Sun,
  SunMoon,
  Table,
  Terminal,
  Trash2,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';

// The application names icons by role. Lucide supplies the drawings, so a new
// icon is a named import here instead of another hand-written path.
const icons = {
  terminal: Terminal,
  branch: GitBranch,
  history: RotateCcwClock,
  chevron: ChevronRight,
  chevronDown: ChevronDown,
  folder: Folder,
  folderOpen: FolderOpen,
  download: Download,
  file: FileText,
  cloud: Cloud,
  cloudUp: CloudUpload,
  cloudConnect: CloudCog,
  book: BookOpen,
  schema: ScrollText,
  layers: Layers,
  graph: Network,
  map: Map,
  columns: Columns3,
  home: House,
  archive: Archive,
  link: Link2,
  info: Info,
  calendar: Calendar,
  plus: Plus,
  minus: Minus,
  more: Ellipsis,
  refresh: RefreshCw,
  search: Search,
  sparkles: Sparkles,
  close: X,
  arrow: ArrowRight,
  back: ArrowLeft,
  up: ArrowUp,
  down: ArrowDown,
  check: Check,
  checkCircle: CircleCheck,
  loader: LoaderCircle,
  clock: Clock,
  lock: Lock,
  shield: Shield,
  zap: Zap,
  penLine: PenLine,
  squarePen: SquarePen,
  sliders: SlidersHorizontal,
  table: Table,
  code: Code,
  trash: Trash2,
  user: User,
  users: Users,
  building: Building2,
  grid: LayoutGrid,
  appearance: SunMoon,
  system: Monitor,
  hearth: Flame,
  light: Sun,
  dark: Moon,
} as const;
export type IconName = keyof typeof icons;

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className = '',
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Glyph = icons[name];
  return (
    <Glyph
      className={`ui-icon ${className}`}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
      style={style}
    />
  );
}
