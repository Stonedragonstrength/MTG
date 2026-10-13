import { isBackId } from '../lib/faces';

/** What a double-faced card wears on the board while it lies on its back:
 * a small mark on its corner. The picture alone does not say it — a card
 * read before back faces were kept still shows its front. */
export default function FaceMark({ cardId }: { cardId: string }) {
  if (!isBackId(cardId)) return null;
  return (
    <span className="face-badge" role="img" aria-label="on its back face" title="On its back face">
      ⟳
    </span>
  );
}
