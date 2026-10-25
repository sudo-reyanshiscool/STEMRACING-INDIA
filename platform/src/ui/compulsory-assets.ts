import type { Ctx } from './ctx';
import type { TeamRow } from '../api';
import {
  COMPULSORY_ASSET_SPECS,
  type CompulsoryAssetKey,
  type TeamCompulsoryAssets,
  type TeamColours,
  type TeamMemberPortrait,
  validateTeamColours,
  extractPngDimensionsFromBase64,
} from '../api/compulsory-assets';
import { h } from './dom';
import { errorText } from './common';

export async function compulsoryAssetsSection(
  ctx: Ctx,
  eventId: string,
  teams: TeamRow[],
  managedTeamIds: string[],
  isStaff: boolean,
): Promise<HTMLElement> {
  const uploadTeams = teams.filter((t) => isStaff || managedTeamIds.includes(t.id));
  const container = h('section', { class: 'stack stack--md compulsory-assets-container' });

  if (uploadTeams.length === 0) {
    return container;
  }

  let currentTeamId = uploadTeams[0].id;
  let assetsState: TeamCompulsoryAssets | null = null;

  const header = h(
    'div',
    { class: 'garage-section-head' },
    h('p', { class: 'eyebrow' }, 'Competition Deliverables'),
    h('h2', null, 'Compulsory Digital Media Submissions'),
    h(
      'p',
      { class: 'muted' },
      'All 8 digital assets below are compulsory submission items. They are required for technical scrutineering, event broadcast introductions, knockout reveals, and ceremony awards.',
    ),
  );
  container.append(header);

  const statusMsg = h('p', { class: 'notice', role: 'status', hidden: true });
  container.append(statusMsg);

  function notify(msg: string, isError = false) {
    statusMsg.textContent = msg;
    statusMsg.hidden = false;
    statusMsg.className = isError ? 'alert' : 'notice';
  }

  // Team Selector if multiple teams
  const teamSelect = h(
    'select',
    { 'aria-label': 'Select team for compulsory asset submission' },
    uploadTeams.map((t) => h('option', { value: t.id, selected: t.id === currentTeamId }, `${t.number} · ${t.name}`)),
  ) as HTMLSelectElement;

  if (uploadTeams.length > 1) {
    container.append(h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team'), teamSelect));
  }

  const dynamicMount = h('div', { class: 'stack stack--md' });
  container.append(dynamicMount);

  teamSelect.onchange = () => {
    currentTeamId = teamSelect.value;
    void refresh();
  };

  async function loadData() {
    try {
      assetsState = await ctx.api.getCompulsoryAssets(eventId, currentTeamId);
    } catch {
      assetsState = null;
    }
  }

  async function refresh() {
    await loadData();
    renderUI();
  }

  function renderUI() {
    dynamicMount.replaceChildren();
    if (!assetsState) {
      dynamicMount.append(h('p', { class: 'muted' }, 'Loading compulsory submission status…'));
      return;
    }

    const state = assetsState;
    const team = uploadTeams.find((t) => t.id === currentTeamId);

    // 1. Progress Banner
    const isComplete = state.isAllCompleted;
    const progressCard = h(
      'article',
      { class: `card compulsory-progress-card ${isComplete ? 'is-complete' : 'is-pending'}` },
      h(
        'div',
        { style: 'display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px;' },
        h('strong', { style: 'font-size: 18px;' }, `${team ? team.name : 'Team'} · Compulsory Submission Readiness`),
        h(
          'span',
          { class: isComplete ? 'tag tag--pass' : 'tag tag--warning' },
          isComplete ? 'All 8 Compulsory Assets Submitted' : `${state.missingKeys.length} Missing Deliverable${state.missingKeys.length === 1 ? '' : 's'}`
        )
      ),
      h('div', { style: 'display: flex; align-items: center; gap: 16px; margin-top: 8px;' },
        h('progress', {
          max: 8,
          value: state.completedCount,
          style: 'flex: 1; height: 12px; border-radius: 6px;',
          'aria-label': `${state.completedCount} of 8 compulsory assets submitted`,
        }),
        h('strong', { style: 'font-variant-numeric: tabular-nums; font-family: var(--font-display);' }, `${state.completedCount} / 8`)
      ),
      h('p', { class: 'muted small', style: 'margin: 0;' },
        isComplete
          ? 'All 8 compulsory assets are safely recorded. You can replace or update any asset before competition results are locked.'
          : 'Complete all 8 required items below to clear registration readiness for the national finals.'
      )
    );
    dynamicMount.append(progressCard);

    // 2. The 8 Assets Table / List
    const tableWrap = h('div', { class: 'table-wrap', style: 'margin-top: 12px; overflow-x: auto;' });
    const table = h('table', { class: 'compulsory-table', style: 'width: 100%; border-collapse: collapse;' });
    const thead = h('thead', null,
      h('tr', { style: 'border-bottom: 2px solid var(--rule); text-align: left; font-size: 12px; text-transform: uppercase; color: var(--fg-muted);' },
        h('th', { style: 'padding: 12px 8px; width: 36px;' }, '#'),
        h('th', { style: 'padding: 12px;' }, 'Asset'),
        h('th', { style: 'padding: 12px;' }, 'Format'),
        h('th', { style: 'padding: 12px;' }, 'Specifications'),
        h('th', { style: 'padding: 12px; width: 140px;' }, 'Status'),
        h('th', { style: 'padding: 12px; text-align: right; width: 120px;' }, 'Action')
      )
    );

    const tbody = h('tbody');

    COMPULSORY_ASSET_SPECS.forEach((spec) => {
      let isDone = false;
      let detailText = '';
      let thumbNode: HTMLElement | null = null;

      switch (spec.key) {
        case 'team_logo':
          isDone = Boolean(state.teamLogo);
          if (state.teamLogo) detailText = state.teamLogo.name;
          break;
        case 'car_render_fl':
          isDone = Boolean(state.carRenderFL);
          if (state.carRenderFL) {
            const dims = state.carRenderFL.width && state.carRenderFL.height ? `${state.carRenderFL.width} × ${state.carRenderFL.height}` : '';
            detailText = `${state.carRenderFL.name} ${dims ? `(${dims})` : ''}`;
          }
          break;
        case 'car_render_fr':
          isDone = Boolean(state.carRenderFR);
          if (state.carRenderFR) {
            const dims = state.carRenderFR.width && state.carRenderFR.height ? `${state.carRenderFR.width} × ${state.carRenderFR.height}` : '';
            detailText = `${state.carRenderFR.name} ${dims ? `(${dims})` : ''}`;
          }
          break;
        case 'car_model_3d':
          isDone = Boolean(state.carModel3D);
          if (state.carModel3D) detailText = state.carModel3D.name;
          break;
        case 'model_materials':
          isDone = Boolean(state.modelMaterials);
          if (state.modelMaterials) detailText = state.modelMaterials.name;
          break;
        case 'official_photo':
          isDone = Boolean(state.officialPhoto);
          if (state.officialPhoto) {
            detailText = state.officialPhoto.originalName || 'Photograph recorded';
          }
          break;
        case 'team_colours':
          isDone = Boolean(state.teamColours && state.teamColours.primary);
          if (state.teamColours) {
            detailText = `${state.teamColours.primary} / ${state.teamColours.secondary} / ${state.teamColours.accent}`;
            thumbNode = h('div', { style: 'display: flex; gap: 4px; margin-top: 4px;' },
              h('span', { style: `width: 14px; height: 14px; border-radius: 3px; background: ${state.teamColours.primary}; border: 1px solid rgba(0,0,0,0.2);`, title: `Primary: ${state.teamColours.primary}` }),
              h('span', { style: `width: 14px; height: 14px; border-radius: 3px; background: ${state.teamColours.secondary}; border: 1px solid rgba(0,0,0,0.2);`, title: `Secondary: ${state.teamColours.secondary}` }),
              h('span', { style: `width: 14px; height: 14px; border-radius: 3px; background: ${state.teamColours.accent}; border: 1px solid rgba(0,0,0,0.2);`, title: `Accent: ${state.teamColours.accent}` })
            );
          }
          break;
        case 'member_portraits':
          isDone = Boolean(state.memberPortraits && state.memberPortraits.length > 0);
          if (state.memberPortraits && state.memberPortraits.length > 0) {
            detailText = `${state.memberPortraits.length} team member portrait${state.memberPortraits.length === 1 ? '' : 's'}`;
          }
          break;
      }

      const row = h('tr', { style: 'border-bottom: 1px solid var(--rule); font-size: 14px;' },
        h('td', { style: 'padding: 14px 8px; font-weight: 700; color: var(--fg-muted);' }, String(spec.num)),
        h('td', { style: 'padding: 14px 12px;' },
          h('strong', null, spec.name),
          detailText ? h('p', { class: 'muted small', style: 'margin: 2px 0 0 0;' }, detailText) : null,
          thumbNode
        ),
        h('td', { style: 'padding: 14px 12px; font-size: 13px; color: var(--fg-muted);' }, spec.format),
        h('td', { style: 'padding: 14px 12px; font-size: 13px;' }, spec.specifications),
        h('td', { style: 'padding: 14px 12px;' },
          h('span', { class: isDone ? 'tag tag--pass' : 'tag tag--fail' }, isDone ? 'Submitted' : 'Compulsory')
        ),
        h('td', { style: 'padding: 14px 12px; text-align: right;' },
          h('button', {
            type: 'button',
            class: 'btn btn--ghost btn--small',
            onclick: () => openAssetManager(spec),
          }, isDone ? 'Manage' : 'Submit')
        )
      );

      tbody.append(row);
    });

    table.append(thead, tbody);
    tableWrap.append(table);
    dynamicMount.append(tableWrap);

    // 3. Quick Action Panels for Team Colours & Member Portraits
    const interactiveGrid = h('div', { class: 'grid', style: 'margin-top: 16px;' });
    interactiveGrid.append(buildColoursWidget(state));
    interactiveGrid.append(buildPortraitsWidget(state));
    dynamicMount.append(interactiveGrid);
  }

  // --- Inline Manager for Team Colours ---
  function buildColoursWidget(state: TeamCompulsoryAssets): HTMLElement {
    const colours = state.teamColours || { primary: '#E6007E', secondary: '#312783', accent: '#FCBC00' };
    const card = h('article', { class: 'card stack' });
    card.append(
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Asset #7'),
        h('h3', null, 'Team Colours (HEX)'),
        h('p', { class: 'muted small' }, 'Official primary, secondary, and accent colors for broadcast palettes.')
      )
    );

    const primaryInput = h('input', { type: 'color', value: colours.primary }) as HTMLInputElement;
    const primaryHex = h('input', { type: 'text', value: colours.primary, maxlength: 7, style: 'width: 90px; text-transform: uppercase;' }) as HTMLInputElement;

    const secondaryInput = h('input', { type: 'color', value: colours.secondary }) as HTMLInputElement;
    const secondaryHex = h('input', { type: 'text', value: colours.secondary, maxlength: 7, style: 'width: 90px; text-transform: uppercase;' }) as HTMLInputElement;

    const accentInput = h('input', { type: 'color', value: colours.accent }) as HTMLInputElement;
    const accentHex = h('input', { type: 'text', value: colours.accent, maxlength: 7, style: 'width: 90px; text-transform: uppercase;' }) as HTMLInputElement;

    primaryInput.oninput = () => { primaryHex.value = primaryInput.value.toUpperCase(); };
    primaryHex.oninput = () => { if (/^#[0-9A-Fa-f]{6}$/.test(primaryHex.value)) primaryInput.value = primaryHex.value; };

    secondaryInput.oninput = () => { secondaryHex.value = secondaryInput.value.toUpperCase(); };
    secondaryHex.oninput = () => { if (/^#[0-9A-Fa-f]{6}$/.test(secondaryHex.value)) secondaryInput.value = secondaryHex.value; };

    accentInput.oninput = () => { accentHex.value = accentInput.value.toUpperCase(); };
    accentHex.oninput = () => { if (/^#[0-9A-Fa-f]{6}$/.test(accentHex.value)) accentInput.value = accentHex.value; };

    const saveBtn = h('button', { type: 'button', class: 'btn btn--primary btn--small' }, 'Save Team Colours');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        await ctx.api.saveTeamColours(eventId, currentTeamId, {
          primary: primaryHex.value,
          secondary: secondaryHex.value,
          accent: accentHex.value,
        });
        notify('Team colours saved successfully.');
        await refresh();
      } catch (err) {
        notify(errorText(err), true);
      } finally {
        saveBtn.disabled = false;
      }
    };

    const colorRow = (label: string, picker: HTMLInputElement, textInput: HTMLInputElement) =>
      h('div', { style: 'display: flex; align-items: center; justify-content: space-between; gap: 8px;' },
        h('span', { class: 'field__label', style: 'margin: 0;' }, label),
        h('div', { style: 'display: flex; align-items: center; gap: 6px;' }, picker, textInput)
      );

    card.append(
      colorRow('Primary', primaryInput, primaryHex),
      colorRow('Secondary', secondaryInput, secondaryHex),
      colorRow('Accent', accentInput, accentHex),
      saveBtn
    );
    return card;
  }

  // --- Inline Manager for Member Portraits ---
  function buildPortraitsWidget(state: TeamCompulsoryAssets): HTMLElement {
    const card = h('article', { class: 'card stack' });
    const members = state.memberPortraits ? [...state.memberPortraits] : [];

    card.append(
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Asset #8'),
        h('h3', null, 'Individual Team Member Portraits'),
        h('p', { class: 'muted small' }, 'Individual portraits with member name and competition role.')
      )
    );

    const membersList = h('div', { class: 'stack stack--sm' });
    function renderMembersList() {
      membersList.replaceChildren();
      if (members.length === 0) {
        membersList.append(h('p', { class: 'muted small' }, 'No team members added yet. Add each team member below.'));
        return;
      }

      members.forEach((m, idx) => {
        const item = h('div', {
          style: 'display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border: 1px solid var(--rule); border-radius: 6px; background: rgba(255,255,255,0.03);',
        },
          h('div', { style: 'display: flex; align-items: center; gap: 10px;' },
            m.photoBase64 ? h('img', {
              src: m.photoBase64.startsWith('data:') ? m.photoBase64 : `data:${m.photoMime || 'image/jpeg'};base64,${m.photoBase64}`,
              alt: m.name,
              style: 'width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid var(--rule);',
            }) : h('span', { style: 'width: 34px; height: 34px; border-radius: 50%; background: var(--bg-subtle); display: inline-flex; align-items: center; justify-content: center; font-size: 11px;' }, '👤'),
            h('div', null,
              h('strong', { style: 'display: block; font-size: 13px;' }, m.name),
              h('span', { class: 'muted small' }, m.role)
            )
          ),
          h('button', {
            type: 'button',
            class: 'btn btn--ghost btn--small',
            style: 'padding: 4px 8px; min-height: 28px; font-size: 11px;',
            onclick: async () => {
              members.splice(idx, 1);
              renderMembersList();
              await ctx.api.saveTeamMemberPortraits(eventId, currentTeamId, members);
              await refresh();
            },
          }, 'Remove')
        );
        membersList.append(item);
      });
    }
    renderMembersList();
    card.append(membersList);

    // Form to add a new member
    const newName = h('input', { type: 'text', placeholder: 'Member Full Name', required: true }) as HTMLInputElement;
    const newRole = h('input', { type: 'text', placeholder: 'Role (e.g. Lead Engineer)', required: true }) as HTMLInputElement;
    const newPhoto = h('input', { type: 'file', accept: '.jpg,.jpeg,.png' }) as HTMLInputElement;
    const addBtn = h('button', { type: 'button', class: 'btn btn--primary btn--small' }, 'Add Member Portrait');

    addBtn.onclick = async () => {
      if (!newName.value.trim() || !newRole.value.trim()) {
        notify('Please enter both name and role for the team member.', true);
        return;
      }
      addBtn.disabled = true;
      try {
        let photoBase64: string | undefined;
        let photoMime: string | undefined;
        let fileName: string | undefined;

        const file = newPhoto.files?.[0];
        if (file) {
          fileName = file.name;
          photoMime = file.type || 'image/jpeg';
          const bytes = new Uint8Array(await file.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
          photoBase64 = btoa(bin);
        }

        const newMember: TeamMemberPortrait = {
          id: `mem-${Date.now()}`,
          name: newName.value.trim(),
          role: newRole.role || newRole.value.trim(),
          fileName,
          photoMime,
          photoBase64,
          updatedAt: new Date().toISOString(),
        };

        members.push(newMember);
        await ctx.api.saveTeamMemberPortraits(eventId, currentTeamId, members);
        newName.value = '';
        newRole.value = '';
        newPhoto.value = '';
        notify('Team member portrait added.');
        await refresh();
      } catch (err) {
        notify(errorText(err), true);
      } finally {
        addBtn.disabled = false;
      }
    };

    const addForm = h('div', { class: 'stack stack--sm', style: 'border-top: 1px solid var(--rule); padding-top: 10px;' },
      h('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px;' }, newName, newRole),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Portrait Photo (JPG/PNG)'), newPhoto),
      addBtn
    );
    card.append(addForm);

    return card;
  }

  // --- Modal / Manager for Single Assets (Files) ---
  function openAssetManager(spec: (typeof COMPULSORY_ASSET_SPECS)[number]) {
    // For asset #6 (Official team photograph), scroll to the dedicated AI background removal section
    if (spec.key === 'official_photo') {
      const el = document.querySelector('.team-photo-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    // For asset #7 (Team colours), scroll to the colours widget
    if (spec.key === 'team_colours') {
      const el = document.querySelector('.compulsory-assets-container .grid');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    // For asset #8 (Member portraits), scroll to the portraits widget
    if (spec.key === 'member_portraits') {
      const el = document.querySelector('.compulsory-assets-container .grid');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }

    // Modal for File Uploads (Assets 1, 2, 3, 4, 5)
    const overlay = h('div', {
      style: 'position: fixed; inset: 0; background: rgba(5,0,11,0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px;',
    });

    const dialog = h('div', {
      class: 'card stack',
      style: 'max-width: 520px; width: 100%; border: 1px solid var(--pitlane-pink); box-shadow: 0 10px 40px rgba(0,0,0,0.8);',
    });

    dialog.append(
      h('div', { style: 'display: flex; justify-content: space-between; align-items: center;' },
        h('div', null,
          h('p', { class: 'eyebrow' }, `Asset #${spec.num} · Compulsory`),
          h('h2', { style: 'margin: 0;' }, spec.name)
        ),
        h('button', {
          type: 'button',
          class: 'btn btn--ghost btn--small',
          onclick: () => overlay.remove(),
        }, '✕')
      ),
      h('p', { class: 'muted' }, spec.specifications)
    );

    let accept = '';
    if (spec.key === 'team_logo') accept = '.svg,.png';
    else if (spec.key === 'car_render_fl' || spec.key === 'car_render_fr') accept = '.png';
    else if (spec.key === 'car_model_3d') accept = '.obj';
    else if (spec.key === 'model_materials') accept = '.zip';

    const fileInput = h('input', { type: 'file', accept, required: true }) as HTMLInputElement;
    const modalStatus = h('p', { class: 'notice', hidden: true });
    const submitBtn = h('button', { type: 'button', class: 'btn btn--primary' }, `Upload ${spec.name}`);

    submitBtn.onclick = async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        modalStatus.textContent = 'Please choose a file.';
        modalStatus.className = 'alert';
        modalStatus.hidden = false;
        return;
      }

      submitBtn.disabled = true;
      modalStatus.textContent = 'Uploading and validating…';
      modalStatus.className = 'notice';
      modalStatus.hidden = false;

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const base64 = btoa(bin);

        // Resolution validation warning for 3840 x 2160 renders
        if (spec.key === 'car_render_fl' || spec.key === 'car_render_fr') {
          const dims = extractPngDimensionsFromBase64(base64);
          if (dims && (dims.width < 3840 || dims.height < 2160)) {
            notify(`Notice: Image is ${dims.width} × ${dims.height}. Recommended specification is 3840 × 2160.`);
          }
        }

        await ctx.api.uploadCompulsoryAsset(eventId, currentTeamId, spec.key, {
          name: file.name,
          mime: file.type || (file.name.endsWith('.obj') ? 'model/obj' : file.name.endsWith('.zip') ? 'application/zip' : 'image/png'),
          base64,
        });

        notify(`${spec.name} submitted successfully.`);
        overlay.remove();
        await refresh();
      } catch (err) {
        modalStatus.textContent = errorText(err);
        modalStatus.className = 'alert';
        submitBtn.disabled = false;
      }
    };

    dialog.append(
      modalStatus,
      h('label', { class: 'field' },
        h('span', { class: 'field__label' }, `Select ${spec.format} file`),
        fileInput
      ),
      h('div', { style: 'display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px;' },
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => overlay.remove() }, 'Cancel'),
        submitBtn
      )
    );

    overlay.append(dialog);
    document.body.append(overlay);
  }

  // Initial load
  void refresh();

  return container;
}
