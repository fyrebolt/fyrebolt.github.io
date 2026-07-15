import SquircleCursor from '../ios/SquircleCursor';
import AppIcon from './AppIcon';
import { APPS, DOCK_APPS } from './apps';
import './home.css';

export default function HomeScreen() {
  return (
    <div className="ios-wallpaper home-root">
      <SquircleCursor />

      <header className="home-header">
        <h1 className="home-title">Hastin Chen</h1>
        <p className="home-subtitle">Tap an app to open it.</p>
      </header>

      <main className="home-grid" aria-label="Apps">
        {APPS.map((app, i) => (
          <AppIcon key={app.id} app={app} index={i} />
        ))}
      </main>

      <nav className="home-dock ios-glass-dock" aria-label="Dock">
        {DOCK_APPS.map((app, i) => (
          <AppIcon key={app.id} app={app} size={72} showLabel={false} index={APPS.length + i} />
        ))}
      </nav>
    </div>
  );
}
