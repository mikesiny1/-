import { createContext, useContext, useEffect, useState } from 'react';
import { defaultBrand, getBrand, saveBrand } from './lib/db';
import type { Brand } from './lib/types';
import { ToastHost } from './components/ui';
import Dashboard from './views/Dashboard';
import Settings from './views/Settings';
import ProjectView from './views/ProjectView';

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export const go = (path: string) => {
  location.hash = path;
};

interface BrandCtx {
  brand: Brand;
  setBrand: (b: Brand) => void;
}
const Ctx = createContext<BrandCtx>({ brand: defaultBrand, setBrand: () => {} });
export const useBrand = () => useContext(Ctx);

export default function App() {
  const hash = useHash();
  const [brand, setBrandState] = useState<Brand>(defaultBrand);
  useEffect(() => {
    getBrand().then(setBrandState);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', brand.accent || '#8a5a3b');
  }, [brand.accent]);
  const setBrand = (b: Brand) => {
    setBrandState(b);
    saveBrand(b);
  };

  const parts = hash.split('/').filter(Boolean);
  let view;
  if (parts[0] === 'p' && parts[1]) view = <ProjectView id={parts[1]} step={parts[2] || 'details'} />;
  else if (parts[0] === 'settings') view = <Settings />;
  else view = <Dashboard />;

  const section = parts[0] === 'settings' ? 'settings' : 'props';

  return (
    <Ctx.Provider value={{ brand, setBrand }}>
      <ToastHost>
        <div className="shell">
          <header className="topbar">
            <a className="wordmark" href="#/">
              <b>מפלס</b>
              <span>סטודיו סיורים לנדל״ן</span>
            </a>
            <nav className="topnav">
              <a href="#/" className={section === 'props' ? 'on' : ''}>
                נכסים
              </a>
              <a href="#/settings" className={section === 'settings' ? 'on' : ''}>
                פרופיל משרד
              </a>
            </nav>
            <span className="who">{brand.agencyName || brand.agentName || 'משרד ללא שם — השלימו פרופיל'}</span>
          </header>
          {view}
        </div>
      </ToastHost>
    </Ctx.Provider>
  );
}
