import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { loadPlatforms } from './data/links.js';
import { loadSite } from './data/site.js';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The published documents load after the first paint: the store links from
// public/app-links.json, and every word and image on the page from
// public/site-content.json. Nothing has to wait for either — the compiled
// defaults are already correct, are what a fresh checkout shows, and stay in
// place if a file is missing or unreadable.
void loadPlatforms();
void loadSite();
