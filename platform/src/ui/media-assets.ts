import type { Ctx } from './ctx';
import type { TeamPhoto, TeamRow, BroadcastPhoto } from '../api';
import { executeBackgroundRemoval, checkResolution, RECOMMENDED_WIDTH, RECOMMENDED_HEIGHT } from '../api';
import { h } from './dom';
import { notFound, errorText } from './common';

export async function mediaAssetsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, teams, initialPhotos] = await Promise.all([
    ctx.api.getEvent(eventId),
    ctx.api.myRoles(eventId),
    ctx.api.listTeams(eventId),
    ctx.api.listTeamPhotos(eventId),
  ]);

  if (!event || !roles.length) return notFound('Event media assets are unavailable.');
  const canManage = roles.some((r) => r.role === 'organiser' || r.role === 'chair');
  if (!canManage && !roles.some((r) => r.role === 'spectator')) {
    return notFound('Media Assets & Background Removal is available to event organisers only.');
  }

  let alive = true;
  ctx.onLeave(() => {
    alive = false;
  });

  let photos = initialPhotos;
  let selectedTeamIds = new Set<string>();
  let statusFilter = 'all';
  let searchQuery = '';
  let workerLimit = 3;
  let isBatchRunning = false;

  const root = h('div', { class: 'stack stack--lg' });

  // Header & Breadcrumbs
  const header = h(
    'div',
    { class: 'stack' },
    h('a', { class: 'back', href: `#/event/${eventId}` }, `← ${event.name}`),
    h('p', { class: 'eyebrow' }, 'Event Management → Media Assets → Background Removal'),
    h('h1', null, 'Team Photography Background Removal'),
    h(
      'p',
      { class: 'lead' },
      'Process, review and approve high-resolution transparent team cutouts for live arena screens, race announcements, and ceremony graphics.',
    ),
  );
  root.append(header);

  // Status message container
  const statusEl = h('p', { role: 'status', 'aria-live': 'polite', class: 'notice', hidden: true });
  root.append(statusEl);

  function showMessage(msg: string, isError = false) {
    statusEl.textContent = msg;
    statusEl.hidden = false;
    statusEl.className = isError ? 'alert' : 'notice';
  }

  // Reload photos from API
  async function refreshPhotos() {
    try {
      photos = await ctx.api.listTeamPhotos(eventId);
      if (alive) renderDashboard();
    } catch (err) {
      if (alive) showMessage(errorText(err), true);
    }
  }

  // Dashboard container
  const dashboardContainer = h('div', { class: 'stack stack--lg' });
  root.append(dashboardContainer);

  function renderDashboard() {
    dashboardContainer.replaceChildren();

    // 1. Metric summary cards
    const uploadedCount = photos.length;
    const pendingCount = photos.filter((p) => p.processingStatus === 'pending').length;
    const processingCount = photos.filter((p) => p.processingStatus === 'processing').length;
    const completedCount = photos.filter((p) => p.processingStatus === 'completed' && p.approvalStatus !== 'approved').length;
    const approvedCount = photos.filter((p) => p.approvalStatus === 'approved').length;
    const failedCount = photos.filter((p) => p.processingStatus === 'failed').length;

    const metrics = h(
      'div',
      { class: 'grid grid--metrics' },
      h('article', { class: 'tile' }, h('p', { class: 'eyebrow' }, 'Total teams'), h('strong', null, String(teams.length)), h('p', { class: 'small muted' }, `${uploadedCount} photos uploaded`)),
      h('article', { class: 'tile' }, h('p', { class: 'eyebrow' }, 'Pending removal'), h('strong', null, String(pendingCount)), h('p', { class: 'small muted' }, 'Awaiting AI processing')),
      h('article', { class: 'tile' }, h('p', { class: 'eyebrow' }, 'Awaiting review'), h('strong', null, String(completedCount)), h('p', { class: 'small muted' }, 'Completed cutouts')),
      h('article', { class: 'tile' }, h('p', { class: 'eyebrow' }, 'Approved for live'), h('strong', null, String(approvedCount)), h('p', { class: 'small muted' }, 'Broadcast ready')),
      h('article', { class: 'tile' }, h('p', { class: 'eyebrow' }, 'Failed jobs'), h('strong', null, String(failedCount)), h('p', { class: 'small muted' }, failedCount ? 'Retry required' : 'No errors')),
    );
    dashboardContainer.append(metrics);

    // 2. Toolbar & Batch Actions
    const selectAllCb = h('input', {
      type: 'checkbox',
      'aria-label': 'Select all photos',
      checked: selectedTeamIds.size > 0 && selectedTeamIds.size === photos.length,
    }) as HTMLInputElement;

    selectAllCb.onchange = () => {
      if (selectAllCb.checked) {
        selectedTeamIds = new Set(photos.map((p) => p.teamId));
      } else {
        selectedTeamIds.clear();
      }
      renderDashboard();
    };

    const workerSelect = h(
      'select',
      { id: 'media-concurrency-select', 'aria-label': 'Worker concurrency limit' },
      [1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: n === workerLimit }, `${n} worker${n > 1 ? 's' : ''}`)),
    ) as HTMLSelectElement;
    workerSelect.onchange = () => {
      workerLimit = Number(workerSelect.value);
    };

    const filterSelect = h(
      'select',
      { id: 'media-status-filter', 'aria-label': 'Filter by status' },
      [
        ['all', 'All teams'],
        ['pending', 'Pending processing'],
        ['completed', 'Needs review / Completed'],
        ['approved', 'Approved for broadcast'],
        ['failed', 'Failed jobs'],
        ['missing', 'Missing photograph'],
      ].map(([val, label]) => h('option', { value: val, selected: val === statusFilter }, label)),
    ) as HTMLSelectElement;
    filterSelect.onchange = () => {
      statusFilter = filterSelect.value;
      renderDashboard();
    };

    const searchInput = h('input', {
      type: 'search',
      id: 'media-search-input',
      placeholder: 'Search team name or number…',
      value: searchQuery,
      'aria-label': 'Search teams',
    }) as HTMLInputElement;
    searchInput.oninput = () => {
      searchQuery = searchInput.value.toLowerCase().trim();
      renderDashboard();
    };

    // Process Selected Button
    const processSelectedBtn = h(
      'button',
      {
        type: 'button',
        id: 'media-process-selected-btn',
        class: 'btn btn--primary',
        disabled: isBatchRunning || selectedTeamIds.size === 0,
      },
      `Process selected (${selectedTeamIds.size})`,
    ) as HTMLButtonElement;
    processSelectedBtn.onclick = () => runBatchProcessing([...selectedTeamIds]);

    // Process All Pending Button
    const pendingPhotos = photos.filter((p) => p.processingStatus === 'pending' || p.processingStatus === 'failed');
    const processAllPendingBtn = h(
      'button',
      {
        type: 'button',
        id: 'media-process-pending-btn',
        class: 'btn btn--ghost',
        disabled: isBatchRunning || pendingPhotos.length === 0,
      },
      `Process all pending (${pendingPhotos.length})`,
    ) as HTMLButtonElement;
    processAllPendingBtn.onclick = () => runBatchProcessing(pendingPhotos.map((p) => p.teamId));

    // Download ZIP Archive Button
    const downloadZipBtn = h(
      'button',
      {
        type: 'button',
        id: 'media-download-zip-btn',
        class: 'btn btn--ghost',
        disabled: isBatchRunning || !photos.some((p) => p.hasApproved || p.hasProcessed),
      },
      'Download cutouts ZIP',
    ) as HTMLButtonElement;
    downloadZipBtn.onclick = () => downloadZipArchive();

    const toolbar = h(
      'div',
      { class: 'actions-bar stack' },
      h('div', { class: 'row row--wrap', style: 'gap: 12px; align-items: center;' },
        h('label', { class: 'inline' }, selectAllCb, ' Select all'),
        h('label', { class: 'inline' }, 'Filter: ', filterSelect),
        h('label', { class: 'inline' }, 'Workers: ', workerSelect),
        h('div', { style: 'flex: 1; min-width: 200px;' }, searchInput),
      ),
      h('div', { class: 'row row--wrap', style: 'gap: 10px;' },
        processSelectedBtn,
        processAllPendingBtn,
        downloadZipBtn,
      ),
    );
    dashboardContainer.append(toolbar);

    // 3. Batch progress indicator (visible when running)
    if (isBatchRunning) {
      const progressBar = h('progress', { max: 100, value: 0, style: 'width: 100%;' }) as HTMLProgressElement;
      const progressLabel = h('p', { class: 'small' }, 'Processing batch queue…');
      dashboardContainer.append(h('div', { class: 'notice stack' }, progressLabel, progressBar));
    }

    // 4. Team list / Table
    const sortedTeams = [...teams].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));

    const filteredTeams = sortedTeams.filter((t) => {
      const photo = photos.find((p) => p.teamId === t.id);
      if (searchQuery) {
        const matches = t.number.toLowerCase().includes(searchQuery) || t.name.toLowerCase().includes(searchQuery) || t.school.toLowerCase().includes(searchQuery);
        if (!matches) return false;
      }
      if (statusFilter === 'missing') return !photo;
      if (statusFilter === 'pending') return photo?.processingStatus === 'pending';
      if (statusFilter === 'completed') return photo?.processingStatus === 'completed' && photo?.approvalStatus !== 'approved';
      if (statusFilter === 'approved') return photo?.approvalStatus === 'approved';
      if (statusFilter === 'failed') return photo?.processingStatus === 'failed';
      return true;
    });

    if (filteredTeams.length === 0) {
      dashboardContainer.append(h('p', { class: 'muted' }, 'No teams match the selected filter.'));
      return;
    }

    const table = h(
      'table',
      { class: 'table', 'aria-label': 'Team photographs' },
      h('thead', null,
        h('tr', null,
          h('th', { scope: 'col', style: 'width: 40px;' }, 'Select'),
          h('th', { scope: 'col' }, 'Team'),
          h('th', { scope: 'col' }, 'Original'),
          h('th', { scope: 'col' }, 'Cutout'),
          h('th', { scope: 'col' }, 'Resolution'),
          h('th', { scope: 'col' }, 'Status'),
          h('th', { scope: 'col' }, 'Actions'),
        ),
      ),
      h('tbody', null,
        filteredTeams.map((t) => {
          const photo = photos.find((p) => p.teamId === t.id);
          const isSelected = selectedTeamIds.has(t.id);

          const rowCb = h('input', {
            type: 'checkbox',
            checked: isSelected,
            disabled: !photo,
            'aria-label': `Select ${t.number} · ${t.name}`,
          }) as HTMLInputElement;
          rowCb.onchange = () => {
            if (rowCb.checked) selectedTeamIds.add(t.id);
            else selectedTeamIds.delete(t.id);
            renderDashboard();
          };

          // Original thumbnail or placeholder
          const origThumb = h('div', { class: 'media-thumb' });
          if (photo) {
            origThumb.textContent = 'Loading…';
            ctx.api.downloadTeamPhoto(eventId, t.id, 'original').then((res) => {
              if (res && res.base64) {
                const img = h('img', {
                  src: `data:${res.mime};base64,${res.base64}`,
                  alt: `${t.name} original`,
                  style: 'width: 64px; height: 48px; object-fit: cover; border-radius: 4px;',
                });
                origThumb.replaceChildren(img);
              }
            }).catch(() => {
              origThumb.textContent = 'Photo';
            });
          } else {
            origThumb.textContent = 'No photo';
          }

          // Cutout preview (on transparent checkerboard)
          const cutoutThumb = h('div', {
            class: 'media-thumb media-thumb--checker',
            style: 'width: 64px; height: 48px; background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 12px 12px; display: flex; align-items: center; justify-content: center; border-radius: 4px;',
          });
          if (photo && (photo.hasApproved || photo.hasProcessed)) {
            const which = photo.hasApproved ? 'approved' : 'processed';
            ctx.api.downloadTeamPhoto(eventId, t.id, which).then((res) => {
              if (res && res.base64) {
                const img = h('img', {
                  src: `data:image/png;base64,${res.base64}`,
                  alt: `${t.name} cutout`,
                  style: 'max-width: 60px; max-height: 44px; object-fit: contain;',
                });
                cutoutThumb.replaceChildren(img);
              }
            }).catch(() => {
              cutoutThumb.textContent = '—';
            });
          } else {
            cutoutThumb.textContent = '—';
          }

          // Resolution badge
          const resInfo = h('div', { class: 'small' });
          if (photo) {
            const w = photo.originalWidth ?? 0;
            const h_val = photo.originalHeight ?? 0;
            const check = checkResolution(w, h_val);
            if (w && h_val) {
              resInfo.append(
                h('span', { class: check.isRecommended ? 'tag tag--pass' : 'tag tag--warning' }, `${w}×${h_val}`),
              );
            } else {
              resInfo.textContent = `${Math.ceil(photo.originalSize / 1024)} KB`;
            }
          } else {
            resInfo.textContent = '—';
          }

          // Status badge
          const statusBadge = h('div');
          if (!photo) {
            statusBadge.append(h('span', { class: 'tag' }, 'No photograph'));
          } else if (photo.approvalStatus === 'approved') {
            statusBadge.append(h('span', { class: 'tag tag--pass' }, 'Approved for live'));
          } else if (photo.processingStatus === 'completed') {
            statusBadge.append(h('span', { class: 'tag' }, 'Needs review'));
          } else if (photo.processingStatus === 'processing') {
            statusBadge.append(h('span', { class: 'tag' }, 'Processing…'));
          } else if (photo.processingStatus === 'failed') {
            statusBadge.append(h('span', { class: 'tag tag--fail' }, 'Failed'));
          } else {
            statusBadge.append(h('span', { class: 'tag tag--warning' }, 'Pending removal'));
          }

          // Actions
          const actionGroup = h('div', { class: 'row row--wrap', style: 'gap: 6px;' });
          if (photo) {
            const reviewBtn = h(
              'button',
              { type: 'button', class: 'btn btn--ghost btn--small', 'data-inspect-photo': t.id },
              'Review & Compare',
            );
            reviewBtn.onclick = () => openComparisonModal(t, photo);
            actionGroup.append(reviewBtn);

            if (photo.processingStatus === 'completed' && photo.approvalStatus !== 'approved') {
              const approveBtn = h(
                'button',
                { type: 'button', class: 'btn btn--primary btn--small' },
                'Approve',
              );
              approveBtn.onclick = async () => {
                approveBtn.disabled = true;
                try {
                  await ctx.api.approveTeamPhoto(eventId, t.id);
                  showMessage(`Approved ${t.number} · ${t.name} for live graphics.`);
                  await refreshPhotos();
                } catch (err) {
                  showMessage(errorText(err), true);
                  approveBtn.disabled = false;
                }
              };
              actionGroup.append(approveBtn);
            }

            if (photo.processingStatus === 'failed' || photo.processingStatus === 'completed') {
              const retryBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--small' }, 'Retry');
              retryBtn.onclick = async () => {
                retryBtn.disabled = true;
                try {
                  await processSinglePhoto(t.id);
                  await refreshPhotos();
                } catch (err) {
                  showMessage(errorText(err), true);
                } finally {
                  retryBtn.disabled = false;
                }
              };
              actionGroup.append(retryBtn);
            }
          }

          return h(
            'tr',
            null,
            h('td', null, rowCb),
            h('td', null, h('strong', null, `${t.number} · ${t.name}`), h('p', { class: 'small muted' }, t.school)),
            h('td', null, origThumb),
            h('td', null, cutoutThumb),
            h('td', null, resInfo),
            h('td', null, statusBadge),
            h('td', null, actionGroup),
          );
        }),
      ),
    );

    dashboardContainer.append(h('div', { class: 'table-wrap' }, table));
  }

  // Single photo processing execution
  async function processSinglePhoto(teamId:string) {
    const {jobId}=await ctx.api.queuePhotoProcessing(eventId,teamId);
    try {
      const orig=await ctx.api.downloadTeamPhoto(eventId,teamId,'original');
      const {cutoutBase64}=await executeBackgroundRemoval(orig.base64);
      if(!await ctx.api.completePhotoProcessing(jobId,'completed',cutoutBase64))throw new Error('The photograph changed during processing. Reload and retry.');
      showMessage('AI background removal complete. Review the cutout before approval.');
    } catch(err) {
      try{await ctx.api.completePhotoProcessing(jobId,'failed',undefined,errorText(err));}catch{/* Keep the original failure visible. */}
      showMessage(`Background removal failed: ${errorText(err)}`,true);throw err;
    }
  }

  // Batch background removal execution with concurrency limit
  async function runBatchProcessing(teamIds: string[]) {
    if (isBatchRunning || !teamIds.length) return;
    isBatchRunning = true;
    renderDashboard();

    let done = 0;
    let failed = 0;
    const total = teamIds.length;
    showMessage(`Processing ${total} photographs (concurrency limit: ${workerLimit})…`);

    const queue = [...teamIds];

    async function worker() {
      while (queue.length > 0 && alive) {
        const teamId = queue.shift()!;
        try {
          await processSinglePhoto(teamId);
          done++;
        } catch {
          failed++;
        }
        showMessage(`Batch progress: ${done + failed} of ${total} finished (${failed} failed).`);
      }
    }

    const workers = Array.from({ length: Math.min(workerLimit, total) }, () => worker());
    await Promise.all(workers);

    isBatchRunning = false;
    showMessage(`Batch background removal finished: ${done} successful, ${failed} failed.`);
    await refreshPhotos();
  }

  // Side-by-Side Review & Comparison Modal
  async function openComparisonModal(team: TeamRow, photo: TeamPhoto) {
    const backdrop = h('div', {
      class: 'media-modal-backdrop',
      style: 'position: fixed; inset: 0; background: rgba(5,0,11,0.85); backdrop-filter: blur(8px); z-index: 900; display: flex; align-items: center; justify-content: center; padding: 20px;',
    });

    const modal = h('div', {
      class: 'stack stack--lg',
      style: 'background: var(--carbon-shadow, #05000B); border: 1px solid var(--carbon-700, #2E2347); border-radius: 8px; width: 100%; max-width: 1100px; max-height: 90vh; overflow-y: auto; padding: 24px; color: #fff;',
    });
    backdrop.append(modal);

    const closeBtn = h('button', { type: 'button', class: 'btn btn--ghost', style: 'align-self: flex-end;' }, '✕ Close');
    closeBtn.onclick = () => backdrop.remove();

    const title = h('h2', null, `${team.number} · ${team.name} — Cutout Review`);
    const subtitle = h('p', { class: 'muted' }, `${team.school} · Asset Version ${photo.version}`);

    const previewContainer = h('div', {
      style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; margin-top: 12px;',
    });

    const leftCol = h('div', { class: 'stack' }, h('h3', null, 'Original photograph'), h('p', { class: 'small muted' }, 'Private image'));
    const rightCol = h('div', { class: 'stack' }, h('h3', null, 'AI transparent cutout'), h('p', { class: 'small muted' }, 'Arena presentation cutout'));

    // Loading indicators
    const origImgHolder = h('div', { style: 'background: #111; border-radius: 6px; padding: 10px; min-height: 260px; display: flex; align-items: center; justify-content: center;' }, 'Loading original…');
    const cutoutImgHolder = h('div', {
      style: 'background: repeating-conic-gradient(#261A3D 0% 25%, #150F24 0% 50%) 50% / 20px 20px; border-radius: 6px; padding: 10px; min-height: 260px; display: flex; align-items: center; justify-content: center;',
    }, 'Loading cutout…');

    leftCol.append(origImgHolder);
    rightCol.append(cutoutImgHolder);
    previewContainer.append(leftCol, rightCol);

    // Fetch images
    ctx.api.downloadTeamPhoto(eventId, team.id, 'original').then((res) => {
      origImgHolder.replaceChildren(
        h('img', {
          src: `data:${res.mime};base64,${res.base64}`,
          alt: `${team.name} original`,
          style: 'max-width: 100%; max-height: 420px; object-fit: contain; border-radius: 4px;',
        }),
      );
    }).catch((err) => {
      origImgHolder.textContent = `Original unavailable: ${err.message}`;
    });

    const whichCutout = photo.hasApproved ? 'approved' : 'processed';
    if (photo.hasApproved || photo.hasProcessed) {
      ctx.api.downloadTeamPhoto(eventId, team.id, whichCutout).then((res) => {
        cutoutImgHolder.replaceChildren(
          h('img', {
            src: `data:image/png;base64,${res.base64}`,
            alt: `${team.name} cutout`,
            style: 'max-width: 100%; max-height: 420px; object-fit: contain;',
          }),
        );
      }).catch((err) => {
        cutoutImgHolder.textContent = `Cutout unavailable: ${err.message}`;
      });
    } else {
      cutoutImgHolder.textContent = 'No cutout generated yet.';
    }

    // Modal action buttons
    const modalStatus = h('p', { class: 'notice small', hidden: true });

    const approveModalBtn = h('button', { type: 'button', class: 'btn btn--primary' }, 'Approve for live broadcast');
    approveModalBtn.onclick = async () => {
      approveModalBtn.disabled = true;
      try {
        await ctx.api.approveTeamPhoto(eventId, team.id);
        modalStatus.textContent = 'Photograph approved! It will now appear on arena broadcast screens.';
        modalStatus.hidden = false;
        await refreshPhotos();
      } catch (err) {
        modalStatus.textContent = errorText(err);
        modalStatus.hidden = false;
      } finally {
        approveModalBtn.disabled = false;
      }
    };

    const rejectModalBtn = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Reject cutout');
    rejectModalBtn.onclick = async () => {
      const reason = prompt('Reason for rejecting photograph (e.g. edge halo, cropped member):') || 'Cutout rejected by organiser';
      try {
        await ctx.api.rejectTeamPhoto(eventId, team.id, reason);
        modalStatus.textContent = 'Cutout rejected.';
        modalStatus.hidden = false;
        await refreshPhotos();
      } catch (err) {
        modalStatus.textContent = errorText(err);
        modalStatus.hidden = false;
      }
    };

    const retryModalBtn = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Retry background removal');
    retryModalBtn.onclick = async () => {
      retryModalBtn.disabled = true;
      try {
        modalStatus.textContent = 'Running AI background removal…';
        modalStatus.hidden = false;
        await processSinglePhoto(team.id);
        modalStatus.textContent = 'Background removal complete. Refreshing…';
        backdrop.remove();
        await refreshPhotos();
      } catch (err) {
        modalStatus.textContent = errorText(err);
      } finally {
        retryModalBtn.disabled = false;
      }
    };

    // Manual Corrected PNG Upload
    const manualFileInput = h('input', { type: 'file', accept: '.png', 'aria-label': 'Upload manually corrected transparent PNG' }) as HTMLInputElement;
    const uploadManualBtn = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Upload corrected PNG');
    uploadManualBtn.onclick = async () => {
      const file = manualFileInput.files?.[0];
      if (!file) {
        alert('Please choose a transparent PNG file.');
        return;
      }
      uploadManualBtn.disabled = true;
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        await ctx.api.uploadCorrectedTeamPhoto(eventId, team.id, {
          base64: btoa(binary),
          notes: 'Manually corrected cutout uploaded by organiser',
        });
        modalStatus.textContent = 'Manual correction applied and approved.';
        modalStatus.hidden = false;
        backdrop.remove();
        await refreshPhotos();
      } catch (err) {
        modalStatus.textContent = errorText(err);
        modalStatus.hidden = false;
        uploadManualBtn.disabled = false;
      }
    };

    const manualSection = h(
      'details',
      null,
      h('summary', null, 'Upload manually corrected cutout (Photoshop / Designer edit)'),
      h('div', { class: 'stack', style: 'margin-top: 10px;' },
        h('p', { class: 'small muted' }, 'Upload a transparent PNG cutout with manual edge or hair touch-ups. This replaces the cutout and approves it immediately.'),
        manualFileInput,
        uploadManualBtn,
      ),
    );

    // Version history section
    const historyList = h('div', { class: 'stack small' });
    ctx.api.listTeamPhotoHistory(eventId, team.id).then((history) => {
      if (!history.length) {
        historyList.append(h('p', { class: 'muted' }, 'No earlier versions saved yet.'));
      } else {
        history.forEach((hItem) => {
          const restoreBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--small' }, 'Restore this version');
          restoreBtn.onclick = async () => {
            restoreBtn.disabled = true;
            try {
              await ctx.api.restoreTeamPhotoVersion(eventId, team.id, hItem.id);
              backdrop.remove();
              await refreshPhotos();
            } catch (err) {
              alert(errorText(err));
              restoreBtn.disabled = false;
            }
          };
          historyList.append(
            h('article', { class: 'row', style: 'justify-content: space-between; align-items: center;' },
              h('div', null,
                h('strong', null, `Version ${hItem.version}`),
                h('p', { class: 'muted' }, `Approved: ${new Date(hItem.approvedAt).toLocaleString('en-IN')}`),
                h('p', { class: 'muted' }, hItem.correctionNotes || 'Standard cutout'),
              ),
              restoreBtn,
            ),
          );
        });
      }
    }).catch(() => {
      historyList.append(h('p', { class: 'muted' }, 'History unavailable.'));
    });

    const historySection = h(
      'details',
      null,
      h('summary', null, 'Version history & restore earlier cutout'),
      h('div', { style: 'margin-top: 10px;' }, historyList),
    );

    modal.append(
      closeBtn,
      title,
      subtitle,
      modalStatus,
      previewContainer,
      h('div', { class: 'row row--wrap', style: 'gap: 10px; margin-top: 14px;' },
        approveModalBtn,
        rejectModalBtn,
        retryModalBtn,
      ),
      manualSection,
      historySection,
    );

    document.body.append(backdrop);
  }

  // ZIP Archive download of all approved cutouts
  async function downloadZipArchive() {
    showMessage('Preparing ZIP archive of team cutouts…');
    try {
      const { Zip, ZipPassThrough, strToU8 } = await import('fflate');
      const parts: Uint8Array<ArrayBuffer>[] = [];
      const zip = new Zip((err, data) => {
        if (err) throw err;
        parts.push(new Uint8Array(data));
      });

      const manifest: Array<{ number: string; name: string; file: string; status: string }> = [];
      const eligiblePhotos = photos.filter((p) => p.hasApproved || p.hasProcessed);

      for (const p of eligiblePhotos) {
        const team = teams.find((t) => t.id === p.teamId);
        if (!team) continue;
        const which = p.hasApproved ? 'approved' : 'processed';
        const res = await ctx.api.downloadTeamPhoto(eventId, p.teamId, which);
        const prefix = team.number.padStart(3, '0').replace(/[^A-Za-z0-9_-]/g, '_');
        const filename = `${prefix}-${team.name.replace(/[^A-Za-z0-9_-]/g, '_')}-cutout.png`;

        manifest.push({
          number: team.number,
          name: team.name,
          file: filename,
          status: p.approvalStatus,
        });

        const entry = new ZipPassThrough(filename);
        zip.add(entry);
        entry.push(Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0)), true);
      }

      const entry = new ZipPassThrough('manifest.json');
      zip.add(entry);
      entry.push(strToU8(JSON.stringify(manifest, null, 2)), true);
      zip.end();

      const blobUrl = URL.createObjectURL(new Blob(parts, { type: 'application/zip' }));
      const eventSlug = event?.name ? event.name.replace(/[^A-Za-z0-9_-]/g, '_') : 'Event';
      const link = h('a', { href: blobUrl, download: `STEM-Racing-${eventSlug}-Cutouts.zip` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showMessage(`Exported ${manifest.length} transparent team cutouts with manifest.`);
    } catch (err) {
      showMessage(`ZIP export failed: ${errorText(err)}`, true);
    }
  }

  renderDashboard();
  return root;
}
