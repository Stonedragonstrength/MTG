import { useState } from 'react';
import type { CommanderEntry, PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';
import AvatarPicker from './AvatarPicker';
import Sheet from './Sheet';

const HISTORY_CAP = 8;

interface Props {
  profile: PlayerProfile | null; // null = create new
  onDone: () => void;
}

export default function ProfileEditor({ profile, onDone }: Props) {
  const saveProfile = useAppStore((s) => s.saveProfile);
  const deleteProfile = useAppStore((s) => s.deleteProfile);
  const [name, setName] = useState(profile?.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatarUrl ?? null);
  const [commanderName, setCommanderName] = useState<string | null>(
    profile?.commanderName ?? null,
  );
  const [commanderColors, setCommanderColors] = useState<string[] | null>(
    profile?.commanderColors ?? null,
  );
  const [commanderImage, setCommanderImage] = useState<string | null>(
    profile?.commanderImage ?? null,
  );
  const [picking, setPicking] = useState<'avatar' | 'commander' | null>(null);
  const history = profile?.commanderHistory ?? [];
  const recentOthers = history.filter((h) => h.name !== commanderName);

  function switchToCommander(entry: CommanderEntry) {
    setCommanderName(entry.name);
    setCommanderColors(entry.colors);
    setCommanderImage(entry.image);
  }

  async function save() {
    const current: CommanderEntry | null = commanderName
      ? { name: commanderName, image: commanderImage, colors: commanderColors }
      : null;
    const commanderHistory = current
      ? [current, ...history.filter((h) => h.name !== current.name)].slice(0, HISTORY_CAP)
      : history;
    await saveProfile({
      id: profile?.id ?? crypto.randomUUID(),
      name: name.trim(),
      avatarUrl,
      commanderName,
      commanderColors,
      commanderImage,
      commanderHistory,
    });
    onDone();
  }

  return (
    <Sheet
      title={profile ? 'Edit player' : 'New player'}
      onClose={onDone}
      footer={
        <>
          <button className="primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
          {profile && (
            <button
              className="danger"
              onClick={async () => {
                await deleteProfile(profile.id);
                onDone();
              }}
            >
              Delete
            </button>
          )}
        </>
      }
    >
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Player name" />
      </label>
      <div className="settings-row">
        <div className="avatar-row">
          {avatarUrl ? (
            <img className="avatar" src={avatarUrl} alt="avatar" />
          ) : (
            <div className="avatar avatar--empty" />
          )}
          <span>Avatar</span>
        </div>
        <button onClick={() => setPicking('avatar')}>Choose card art…</button>
      </div>
      <div className="settings-row">
        <div className="settings-row-text">
          <span>Commander</span>
          <small>{commanderName ?? 'None set'}</small>
        </div>
        <button onClick={() => setPicking('commander')}>Pick…</button>
      </div>
      {recentOthers.length > 0 && (
        <div className="chip-group">
          <span className="chip-group-label">Recent commanders</span>
          <div className="chip-row">
            {recentOthers.map((entry) => (
              <button
                key={entry.name}
                className="chip chip--art"
                aria-label={`switch commander to ${entry.name}`}
                onClick={() => switchToCommander(entry)}
              >
                {entry.image && <img className="chip-art" src={entry.image} alt="" loading="lazy" />}
                <span className="chip-name">{entry.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {picking && (
        <AvatarPicker
          title={picking === 'avatar' ? 'Pick avatar art' : 'Pick commander'}
          onPick={(card) => {
            if (picking === 'avatar') setAvatarUrl(card.imageArtCrop ?? card.imageNormal);
            else {
              setCommanderName(card.name);
              setCommanderColors(card.colorIdentity ?? card.colors);
              setCommanderImage(card.imageNormal);
            }
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </Sheet>
  );
}
