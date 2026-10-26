import type { Ctx } from './ctx';
import type { TeamRow, TeamPhoto } from '../api';
import { checkResolution, PHOTO_MAX_BYTES, RECOMMENDED_WIDTH, RECOMMENDED_HEIGHT } from '../api';
import { h } from './dom';
import { errorText } from './common';

export async function teamPhotoUploadSection(
  ctx: Ctx,
  eventId: string,
  teams: TeamRow[],
  managedTeamIds: string[],
  isStaff: boolean,
): Promise<HTMLElement> {
  const event=await ctx.api.getEvent(eventId);
  const uploadTeams = teams.filter((t) => isStaff || managedTeamIds.includes(t.id));
  const container = h('section', { class: 'stack stack--md team-photo-section' });

  let photos: TeamPhoto[] = [];
  try {
    photos = await ctx.api.listTeamPhotos(eventId);
  } catch {
    // If not accessible or fails, ignore
  }

  const head = h(
    'div',
    { class: 'garage-section-head' },
    h('h2', null, 'Official Team Photograph'),
    h(
      'p',
      { class: 'muted' },
      'Required competition deliverable. Your official photograph is used for arena event screens, team introductions, knockout announcements, and awards graphics.',
    ),
  );
  container.append(head);

  const statusMsg = h('p', { class: 'notice', role: 'status', hidden: true });
  container.append(statusMsg);

  function notify(msg: string, isError = false) {
    statusMsg.textContent = msg;
    statusMsg.hidden = false;
    statusMsg.className = isError ? 'alert' : 'notice';
  }

  if (uploadTeams.length === 0) {
    container.append(h('p', { class: 'muted' }, 'No teams available for photograph submission.'));
    return container;
  }

  // Active selected team
  let currentTeamId = uploadTeams[0].id;
  const teamSelect = h(
    'select',
    { 'aria-label': 'Select team for photograph upload' },
    uploadTeams.map((t) => h('option', { value: t.id, selected: t.id === currentTeamId }, `${t.number} · ${t.name}`)),
  ) as HTMLSelectElement;

  const currentPhotoHolder = h('div', { class: 'stack' });
  if (uploadTeams.length > 1) {
    container.append(h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team'), teamSelect));
  }
  container.append(currentPhotoHolder);

  teamSelect.onchange = () => {
    currentTeamId = teamSelect.value;
    renderCurrentState();
  };

  function renderCurrentState() {
    currentPhotoHolder.replaceChildren();
    const photo = photos.find((p) => p.teamId === currentTeamId);

    if (photo) {
      const statusLabel =
        photo.approvalStatus === 'approved'
          ? 'Approved for live broadcast'
          : photo.processingStatus === 'completed'
            ? 'Background removed · Awaiting organiser approval'
            : photo.processingStatus === 'processing'
              ? 'AI Background removal in progress…'
              : photo.processingStatus === 'failed'
                ? `Background removal failed: ${photo.processingError || 'Retry required'}`
                : 'Queued for automatic AI background removal';

      const tagClass =
        photo.approvalStatus === 'approved'
          ? 'tag tag--pass'
          : photo.processingStatus === 'failed'
            ? 'tag tag--fail'
            : photo.processingStatus === 'completed'
              ? 'tag'
              : 'tag tag--warning';

      const thumbHolder = h('div', {
        style: 'display: flex; gap: 16px; align-items: center; flex-wrap: wrap; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px;',
      });

      const imgPreview = h('div', {
        style: 'width: 120px; height: 80px; background: #111; border-radius: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden;',
      }, 'Loading…');

      ctx.api.downloadTeamPhoto(eventId, currentTeamId, 'original').then((res) => {
        if (res && res.base64) {
          imgPreview.replaceChildren(
            h('img', {
              src: `data:${res.mime};base64,${res.base64}`,
              alt: 'Current photograph',
              style: 'width: 100%; height: 100%; object-fit: cover;',
            }),
          );
        }
      }).catch(() => {
        imgPreview.textContent = 'Photo';
      });

      const details = h(
        'div',
        { class: 'stack small' },
        h('strong', null, photo.originalName),
        h('p', { class: 'muted' }, `${photo.originalWidth ?? '—'} × ${photo.originalHeight ?? '—'} px · Version ${photo.version} · Uploaded ${new Date(photo.uploadedAt).toLocaleDateString('en-IN')}`),
        h('div', null, h('span', { class: tagClass }, statusLabel)),
      );

      thumbHolder.append(imgPreview, details);
      currentPhotoHolder.append(
        thumbHolder,
        h('p', { class: 'small muted' }, 'Original photograph is safely preserved. You can replace it with a higher-resolution photograph below at any time.'),
      );
    } else {
      currentPhotoHolder.append(
        h('p', { class: 'notice' }, 'No official photograph uploaded yet. Please upload your team photograph below.'),
      );
    }

    if(event?.resultsReleased){currentPhotoHolder.append(h('p',{class:'notice'},'Results are released. Photograph uploads are locked.'));return;}

    // Upload Form
    const fileInput = h('input', {
      type: 'file',
      accept: '.jpg,.jpeg,.png,image/jpeg,image/png',
      required: true,
      'aria-label': 'Select official team photograph',
    }) as HTMLInputElement;

    const consentCheckbox = h('input', {
      type: 'checkbox',
      required: true,
      id: `photo-consent-${currentTeamId}`,
    }) as HTMLInputElement;

    const consentLabel = h(
      'label',
      { class: 'inline small', for: `photo-consent-${currentTeamId}` },
      consentCheckbox,
      ' I confirm that all team members and their parent/guardian have consented to their photograph being taken, processed with AI background removal, and displayed on event broadcast screens, awards presentations, and event graphics.',
    );

    const previewArea = h('div', { class: 'stack', style: 'margin-top: 8px;', hidden: true });
    const previewImg = h('img', {
      style: 'max-width: 320px; max-height: 180px; object-fit: contain; border-radius: 4px; border: 1px solid var(--carbon-500);',
    }) as HTMLImageElement;
    const resWarning = h('p', { class: 'small' });
    previewArea.append(previewImg, resWarning);

    let selectedDimensions: { width: number; height: number } | null = null;

    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      if (!file) {
        previewArea.hidden = true;
        return;
      }
      if (file.size > PHOTO_MAX_BYTES) {
        notify(`Photograph must be 25 MB or smaller. Selected file is ${(file.size / (1024 * 1024)).toFixed(1)} MB.`, true);
        fileInput.value = '';
        previewArea.hidden = true;
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        previewImg.src = dataUrl;
        previewArea.hidden = false;

        const img = new Image();
        img.onload = () => {
          selectedDimensions = { width: img.naturalWidth, height: img.naturalHeight };
          const check = checkResolution(img.naturalWidth, img.naturalHeight);
          if (!check.isRecommended) {
            resWarning.textContent = check.warning!;
            resWarning.className = 'alert small';
          } else {
            resWarning.textContent = `✓ Recommended 4K quality confirmed (${img.naturalWidth} × ${img.naturalHeight} px).`;
            resWarning.className = 'notice small';
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };

    const uploadBtn = h(
      'button',
      { type: 'submit', class: 'btn btn--primary' },
      photo ? 'Replace photograph' : 'Upload photograph',
    ) as HTMLButtonElement;

    const progressBar = h('progress', { max: 100, value: 0, hidden: true, style: 'width: 100%;' }) as HTMLProgressElement;

    const form = h(
      'form',
      {
        class: 'form stack',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          if (uploadBtn.disabled) return;
          const file = fileInput.files?.[0];
          if (!file) {
            notify('Please choose a photograph.', true);
            return;
          }
          if (!consentCheckbox.checked) {
            notify('Media & minor consent acknowledgement is required.', true);
            return;
          }

          const targetTeamId=currentTeamId;
          if(file.size>PHOTO_MAX_BYTES){notify('Photograph must be 25 MB or smaller.',true);return;}
          uploadBtn.disabled = true;
          progressBar.hidden = false;
          progressBar.value = 25;
          notify('Uploading official photograph…');

          try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            }

            progressBar.value = 60;
            notify('Saving photograph to secure storage…');

            await ctx.api.uploadTeamPhoto(eventId, targetTeamId, photo?.revision ?? 0, {
              name: file.name,
              mime: file.type || (file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'),
              base64: btoa(binary),
              mediaConsent: true,
              width: selectedDimensions?.width,
              height: selectedDimensions?.height,
            });

            progressBar.value = 100;
            notify('Photograph saved and queued for organiser processing and review.');

            photos = await ctx.api.listTeamPhotos(eventId);
            renderCurrentState();
            ctx.rerender();
          } catch (err) {
            notify(errorText(err), true);
          } finally {
            uploadBtn.disabled = false;
            progressBar.hidden = true;
          }
        },
      },
      h('label', { class: 'field' },
        h('span', { class: 'field__label' }, 'Photograph file (JPG or PNG, up to 25 MB)'),
        fileInput,
      ),
      previewArea,
      h('p', { class: 'small muted' }, `Recommended resolution: ${RECOMMENDED_WIDTH} × ${RECOMMENDED_HEIGHT} px (4K) or higher. All team members must be clearly visible in full team attire.`),
      consentLabel,
      uploadBtn,
      progressBar,
    );

    currentPhotoHolder.append(form);
  }

  renderCurrentState();
  return container;
}
