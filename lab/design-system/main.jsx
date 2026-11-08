import { createRoot } from 'react-dom/client';
import { CellRoot } from './cell.jsx';
import { Frame } from './frame.jsx';
import { Shell } from './shell.jsx';
import { cellId, isFrame } from './state.js';

createRoot(document.getElementById('root')).render(isFrame() ? (cellId() ? <CellRoot /> : <Frame />) : <Shell />);
