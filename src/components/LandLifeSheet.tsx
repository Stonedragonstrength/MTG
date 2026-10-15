import Sheet from './Sheet';

interface Props {
  /** The land's name, for the title. */
  name: string;
  /** What it asks: 2 for a shock land, 3 for The Black Gate and the lands on
   * the back of the Zendikar Rising spells (lands.entryLife). */
  life: number;
  /** `pay`: the life is paid and the land comes in untapped; else tapped. */
  onAnswer: (pay: boolean) => void;
  onClose: () => void;
}

/** "As this land enters, you may pay 2 life. If you don't, it enters
 * tapped." — asked wherever such a land comes in: played from the hand, or
 * put onto the battlefield by a search or from a graveyard. */
export default function LandLifeSheet({ name, life, onAnswer, onClose }: Props) {
  return (
    <Sheet title={name.split(' // ')[0]} onClose={onClose}>
      <p className="hint">Pay {life} life for it to come in untapped, or let it come in tapped.</p>
      <div className="chip-row shock-choice">
        <button className="primary" onClick={() => onAnswer(true)}>
          Pay {life} life · untapped
        </button>
        <button onClick={() => onAnswer(false)}>Tapped</button>
      </div>
    </Sheet>
  );
}
