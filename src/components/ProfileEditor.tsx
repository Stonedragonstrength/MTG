import { useState } from 'react';
import type { PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';
import AvatarPicker from './AvatarPicker';

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
  const [picking, setPicking] = useState<'avatar' | 'commander' | null>(null);

  async function save() {
    await saveProfile({
      id: profile?.id ?? crypto.randomUUID(),
      name: name.trim(),
      avatarUrl,
      commanderName,
    });
    onDone();
  }

  return (
    <div className="modal-backdrop">
      <div className="modal profile-editor">
        <h2>{profile ? 'Edit player' : 'New player'}</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Player name" />
        </label>
        <div className="avatar-row">
          {avatarUrl ? (
            <img className="avatar" src={avatarUrl} alt="avatar" />
          ) : (
            <div className="avatar avatar--empty" />
          )}
          <button onClick={() => setPicking('avatar')}>Choose card art…</button>
        </div>
        <div className="commander-row">
          <span>Commander: {commanderName ?? 'none'}</span>
          <button onClick={() => setPicking('commander')}>Pick…</button>
        </div>
        <div className="modal-actions">
          <button disabled={!name.trim()} onClick={save}>
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
          <button className="ghost" onClick={onDone}>
            Cancel
          </button>
        </div>
        {picking && (
          <AvatarPicker
            title={picking === 'avatar' ? 'Pick avatar art' : 'Pick commander'}
            onPick={(card) => {
              if (picking === 'avatar') setAvatarUrl(card.imageArtCrop ?? card.imageNormal);
              else setCommanderName(card.name);
              setPicking(null);
            }}
            onClose={() => setPicking(null)}
          />
        )}
      </div>
    </div>
  );
}
