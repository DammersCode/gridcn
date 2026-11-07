export const SECTION_DEFAULT_ICONS: Record<string, string> = {
  '(learn)': 'Sparkles',
  '(build)': 'Hammer',
  '(server)': 'Server',
  '(evaluate)': 'Gauge',
  '(reference)': 'BookOpen',
  '(examples)': 'Blocks',
};

const FALLBACK_ICON = 'FileText';

export function defaultIconFor(filePath: string | undefined): string {
  const section = filePath?.replaceAll('\\', '/').split('/').find((segment) => segment in SECTION_DEFAULT_ICONS);
  return (section && SECTION_DEFAULT_ICONS[section]) || FALLBACK_ICON;
}
