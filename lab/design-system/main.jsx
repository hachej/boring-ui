import { createRoot } from 'react-dom/client';
import { Frame } from './frame.jsx';
import { Shell } from './shell.jsx';
import { isFrame } from './state.js';

createRoot(document.getElementById('root')).render(isFrame() ? <Frame /> : <Shell />);
