import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import App from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <TooltipProvider delayDuration={450}>
    <App />
  </TooltipProvider>,
);
