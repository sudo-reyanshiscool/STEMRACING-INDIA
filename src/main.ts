import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/components.css';
import { registerSW } from 'virtual:pwa-register';
import { openStore, type Store } from './store';
import type { Ctx } from './ui/ctx';
import { h } from './ui/dom';
import { checklistScreen } from './ui/checklist';
import { eventScreen } from './ui/event';
import { compareScreen } from './ui/compare';
import { homeScreen } from './ui/home';
import { startRouter, type Route } from './ui/router';
import { mountShell } from './ui/shell';
import { summaryScreen } from './ui/summary';

registerSW({ immediate: true });

const root = document.getElementById('app')!;
const { main } = mountShell(root);

async function boot(): Promise<void> {
  let store: Store;
  try {
    store = await openStore();
  } catch {
    main.replaceChildren(
      h('h1', null, 'Storage unavailable'),
      h('p', { class: 'alert', role: 'alert' }, 'This browser cannot save data (private browsing or blocked storage). Open the app in a normal window, then reload.'),
    );
    return;
  }

  let current: Route = { name: 'home' };
  const ctx: Ctx = { store, main, rerender: () => void render(current) };

  async function render(route: Route): Promise<void> {
    current = route;
    try {
      let node: HTMLElement;
      switch (route.name) {
        case 'home': node = await homeScreen(ctx); break;
        case 'event': node = await eventScreen(ctx, route.eventId); break;
        case 'car': node = await checklistScreen(ctx, route.carId); break;
        case 'summary': node = await summaryScreen(ctx, route.carId); break;
        case 'compare': node = await compareScreen(ctx, route.teamId); break;
        default: node = h('p', null, 'This screen is not built yet.');
      }
      main.replaceChildren(node);
      window.scrollTo(0, 0);
    } catch {
      main.replaceChildren(h('h1', null, 'Something went wrong'), h('p', { class: 'alert', role: 'alert' }, 'Could not load this screen. Go back and try again.'), h('a', { href: '#/' }, 'Back to events'));
    }
  }

  startRouter((route) => void render(route));
}

void boot();
