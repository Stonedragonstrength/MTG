/** EDHREC page for a card: real aggregated deck data, for when wifi exists. */
export function edhrecUrl(name: string, isCommander: boolean): string {
  const front = name.split(' // ')[0];
  const slug = front
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `https://edhrec.com/${isCommander ? 'commanders' : 'cards'}/${slug}`;
}
