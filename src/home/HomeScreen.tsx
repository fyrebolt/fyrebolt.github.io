import IpadFrame from '../ios/IpadFrame';
import AppIcon from './AppIcon';
import { APPS, DOCK_APPS } from './apps';
import './home.css';

export default function HomeScreen() {
  return (
    <IpadFrame orientation="portrait" ariaLabel="iPad home screen" contentClassName="home-content">
      <header className="home-header">
        <h1 className="home-title">Hastin Chen</h1>
        <p className="home-subtitle">Tap an app to explore my work</p>
      </header>

      <main className="home-grid" aria-label="Apps">
        {APPS.map((app, i) => (
          <AppIcon key={app.id} app={app} index={i} />
        ))}
      </main>

      <nav className="home-dock ios-glass-dock" aria-label="Dock">
        {DOCK_APPS.map((app, i) => (
          <AppIcon
            key={app.id}
            app={app}
            size={64}
            showLabel={false}
            index={APPS.length + i}
          />
        ))}
      </nav>
    </IpadFrame>
  );
}
