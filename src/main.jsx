import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const redirectUrl = String(import.meta.env.VITE_APP_REDIRECT_URL || '').trim();

if (redirectUrl) {
  window.location.replace(redirectUrl);
} else {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
