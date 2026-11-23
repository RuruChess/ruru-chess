import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ClosePrompt } from './windows/ClosePrompt.tsx';
import { CLOSE_KEY } from './store.ts';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode>{CLOSE_KEY ? <ClosePrompt pk={CLOSE_KEY} /> : <App />}</StrictMode>);
