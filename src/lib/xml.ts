export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function fullDate(value?: string): string | undefined {
  return value?.length === 10 ? value : undefined;
}

export function rfc822Date(value?: string): string | undefined {
  if (!value || value.length !== 10) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? undefined : date.toUTCString();
}
