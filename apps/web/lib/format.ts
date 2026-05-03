export function formatChapterTitle(partNumber: number, title: string): string {
  const titleCase = title
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `Chapter ${partNumber} - ${titleCase}`;
}
