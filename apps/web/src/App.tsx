import { useEffect } from 'react';
import { PlayPage } from './game/PlayPage.tsx';
import { useHashRoute } from './lib/route.ts';
import { VerifyPage } from './verify/VerifyPage.tsx';

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--surface-raised)" />
      <g fill="var(--board-peg)">
        <circle cx="16" cy="9" r="1.6" />
        <circle cx="11" cy="15" r="1.6" />
        <circle cx="21" cy="15" r="1.6" />
        <circle cx="6" cy="21" r="1.6" />
        <circle cx="16" cy="21" r="1.6" />
        <circle cx="26" cy="21" r="1.6" />
      </g>
      <circle cx="13.5" cy="12" r="2.6" fill="var(--accent)" />
    </svg>
  );
}

export function App() {
  const route = useHashRoute();
  const page = route.page === 'verify' ? `verify?${route.query}` : 'play';
  // Hash navigation keeps the scroll position; a new page should start at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="shell">
        <header className="site-header">
          <a className="brand" href="#/">
            <Logo />
            Drop-Win
          </a>
          <nav className="nav" aria-label="Main">
            <a href="#/" aria-current={route.page === 'play' ? 'page' : undefined}>
              Play
            </a>
            <a href="#/verify" aria-current={route.page === 'verify' ? 'page' : undefined}>
              Verify
            </a>
          </nav>
        </header>
        <div id="main" tabIndex={-1}>
          {route.page === 'verify' ? (
            <VerifyPage key={route.query} query={route.query} />
          ) : (
            <PlayPage />
          )}
        </div>
        <footer className="site-footer">
          Play money only. There is no real-money, deposit or crypto feature, and balances have no
          value.
        </footer>
      </div>
    </>
  );
}
