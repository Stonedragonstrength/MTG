import { Component, type ReactNode } from 'react';
import { kvDelete } from '../data/db';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Last line of defense: a render crash shows a recovery screen instead of a
 * white page, and "Start fresh" clears the saved game so a corrupt state
 * can't crash-loop on every launch. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  async startFresh() {
    try {
      await kvDelete('activeGame');
    } catch {
      // If even the DB is broken, reloading is still the best we can do.
    }
    location.reload();
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen">
          <h1>MTG Companion</h1>
          <p>Something went wrong.</p>
          <p className="error">{this.state.error.message}</p>
          <button onClick={() => void this.startFresh()}>Start fresh</button>
          <p className="hint">This clears the game in progress. Players and cards are kept.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
