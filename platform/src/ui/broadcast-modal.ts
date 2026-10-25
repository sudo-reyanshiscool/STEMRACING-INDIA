import type { Ctx } from './ctx';
import type { BroadcastPhoto } from '../api';
import { h } from './dom';

export interface ArenaModalOptions {
  roundName: string;
  label?: string;
  winnerId?: string | null;
}

export async function openArenaPairingModal(
  ctx: Ctx,
  eventId: string,
  team1Id: string,
  team2Id: string,
  options: ArenaModalOptions,
): Promise<void> {
  const [photo1, photo2] = await Promise.all([
    ctx.api.getBroadcastTeamPhoto(eventId, team1Id),
    ctx.api.getBroadcastTeamPhoto(eventId, team2Id),
  ]);

  const backdrop = h('div', {
    class: 'arena-modal-backdrop',
    style:
      'position: fixed; inset: 0; background: #000; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; font-family: var(--body, system-ui); color: #fff;',
  });

  const stage = h('div', {
    class: 'arena-stage',
    style:
      'position: relative; width: 100%; max-width: 1440px; aspect-ratio: 16/9; max-height: 96vh; background: radial-gradient(circle at 50% 30%, #261A3D 0%, #05000B 75%); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; padding: 32px 48px; box-shadow: 0 0 80px rgba(150,27,129,0.3); border: 1px solid rgba(255,255,255,0.1);',
  });
  backdrop.append(stage);

  // Top header
  const titleText = options.roundName.toUpperCase();
  const kicker = options.roundName.includes('Final')
    ? 'GRAND FINAL INTRODUCTIONS'
    : options.roundName.includes('Semi')
      ? 'SEMI-FINAL PAIRING REVEAL'
      : options.roundName.includes('Quarter')
        ? 'QUARTER-FINAL PAIRING REVEAL'
        : 'KNOCKOUT RACE ANNOUNCEMENT';

  const closeBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost',
      style:
        'position: absolute; top: 20px; right: 24px; z-index: 20; color: #fff; background: rgba(0,0,0,0.5); border-radius: 20px; padding: 6px 16px;',
    },
    '✕ Close Screen',
  );
  closeBtn.onclick = () => backdrop.remove();
  stage.append(closeBtn);

  const head = h(
    'header',
    { style: 'text-align: center; z-index: 10; margin-top: 10px;' },
    h('p', {
      style:
        'letter-spacing: 0.25em; text-transform: uppercase; font-size: 14px; color: var(--gold, #FCBC00); font-weight: 500; margin-bottom: 6px;',
    }, kicker),
    h('h1', {
      style:
        'font-family: var(--display, system-ui); font-size: clamp(32px, 4vw, 56px); font-weight: 700; font-style: italic; background: linear-gradient(90deg, #961B81 -10%, #E6007E 50%, #ED6D05 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
    }, options.label ? `${titleText} · ${options.label}` : titleText),
  );
  stage.append(head);

  // Competitor Card Render
  function renderCompetitorPodium(p: BroadcastPhoto, isWinner: boolean, laneLabel: string) {
    const card = h('div', {
      class: 'arena-podium stack',
      style:
        'flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; position: relative; height: 100%; text-align: center; z-index: 5;',
    });

    // Image slot
    const imgSlot = h('div', {
      style:
        'width: 100%; height: 60%; display: flex; align-items: flex-end; justify-content: center; position: relative;',
    });

    if (p.isApprovedPhoto && p.photoBase64) {
      const img = h('img', {
        src: `data:image/png;base64,${p.photoBase64}`,
        alt: `${p.teamName} team photo`,
        style:
          'max-width: 90%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 15px 25px rgba(0,0,0,0.8)) drop-shadow(0 0 35px rgba(230,0,126,0.35)); transition: transform 0.4s ease;',
      });
      imgSlot.append(img);
    } else if (p.logoBase64) {
      const logo = h('img', {
        src: `data:${p.logoMime || 'image/png'};base64,${p.logoBase64}`,
        alt: `${p.teamName} logo`,
        style:
          'max-width: 60%; max-height: 80%; object-fit: contain; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.8));',
      });
      imgSlot.append(logo);
    } else {
      // Fallback racing signifier silhouette
      const signifier = h('div', {
        style:
          'width: 140px; height: 140px; border-radius: 50%; background: linear-gradient(135deg, #261A3D, #05000B); border: 2px solid var(--gold, #FCBC00); display: flex; align-items: center; justify-content: center; font-size: 40px; color: #fff; font-family: var(--display);',
      }, p.teamNumber);
      imgSlot.append(signifier);
    }

    // Info card
    const info = h('div', {
      style:
        'margin-top: 16px; background: rgba(5,0,11,0.7); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 12px 24px; width: 85%; backdrop-filter: blur(10px);',
    });

    const laneBadge = h('p', {
      style: 'font-size: 13px; font-weight: 700; letter-spacing: 0.15em; color: var(--gold, #FCBC00);',
    }, `${laneLabel} · TEAM ${p.teamNumber}`);

    const name = h('h2', {
      style:
        'font-family: var(--display, system-ui); font-size: clamp(20px, 2.4vw, 32px); font-weight: 700; font-style: italic; color: #fff; margin: 4px 0;',
    }, p.teamName);

    const school = h('p', {
      style: 'font-size: clamp(12px, 1.2vw, 16px); color: rgba(255,255,255,0.75);',
    }, p.school || 'STEM Racing India Finalist');

    info.append(laneBadge, name, school);

    if (isWinner) {
      const winBadge = h('div', {
        style:
          'margin-top: 8px; background: linear-gradient(90deg, #FCBC00, #ED6D05); color: #05000B; font-weight: 700; font-size: 14px; letter-spacing: 0.1em; padding: 4px 14px; border-radius: 20px; text-transform: uppercase;',
      }, '★ MATCH WINNER · ADVANCES');
      info.append(winBadge);
    }

    card.append(imgSlot, info);
    return card;
  }

  // Versus Middle Badge
  const vsCenter = h('div', {
    style:
      'display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10; margin: 0 10px;',
  });
  const vsBadge = h('div', {
    style:
      'font-family: var(--display, system-ui); font-size: clamp(36px, 4vw, 64px); font-weight: 700; font-style: italic; background: linear-gradient(135deg, #FCBC00 0%, #E6007E 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 15px rgba(252,188,0,0.6));',
  }, 'VS');
  vsCenter.append(vsBadge);

  // Main arena field
  const arenaField = h('div', {
    style:
      'flex: 1; display: flex; align-items: center; justify-content: space-between; width: 100%; position: relative; margin-top: 10px;',
  });

  const card1 = renderCompetitorPodium(photo1, options.winnerId === team1Id, 'LANE 1');
  const card2 = renderCompetitorPodium(photo2, options.winnerId === team2Id, 'LANE 2');

  arenaField.append(card1, vsCenter, card2);
  stage.append(arenaField);

  // Keyboard shortcut: Escape closes modal
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', onKey);
      backdrop.remove();
    }
  };
  window.addEventListener('keydown', onKey);

  document.body.append(backdrop);
}
