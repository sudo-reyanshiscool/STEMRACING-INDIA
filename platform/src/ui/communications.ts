import type { Ctx } from './ctx';
import { h } from './dom';
import { PANEL_LABEL } from './labels';
import type { BroadcastEmail, NewBroadcastInput, Panel, RoleRow } from '../api';
import { markdownToEmailHtml } from '../engine/broadcast-template';

export async function communicationsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, broadcasts] = await Promise.all([
    ctx.api.getEvent(eventId),
    ctx.api.listRoles(eventId),
    ctx.api.listBroadcasts(eventId),
  ]);

  if (!event) {
    return h('div', { class: 'stack' }, h('h1', null, 'Event not found'));
  }

  const judges = roles.filter((r) => r.role === 'judge' || r.role === 'lead_judge');

  // Form State
  let audienceType: NewBroadcastInput['audienceType'] = 'all_judges';
  let selectedPanel: Panel = 'verbal';
  const selectedJudgeIds = new Set<string>();
  let customEmailsText = '';
  let categoryText = 'EVENT ANNOUNCEMENT';
  let subjectText = '';
  let bodyText = '';
  let buttonText = '';
  let buttonUrl = '';

  const root = h('div', { class: 'stack' });

  root.appendChild(
    h('header', { class: 'stack' },
      h('h1', null, 'Communications & Email Broadcasts'),
      h('p', { class: 'meta' }, 'Compose and send branded emails through the platform to judges, panels, or custom recipients.')
    )
  );

  const alertBox = h('div', { role: 'alert', hidden: true });
  root.appendChild(alertBox);

  const showAlert = (msg: string, isError = true) => {
    alertBox.textContent = msg;
    alertBox.className = isError ? 'alert alert-error' : 'alert alert-success';
    alertBox.hidden = false;
  };
  const clearAlert = () => {
    alertBox.hidden = true;
    alertBox.textContent = '';
  };

  // Preview elements
  const previewCategory = h('p', { style: 'margin:0 0 10px;font-family:Trebuchet MS,Arial,sans-serif;font-size:11px;letter-spacing:2px;font-weight:bold;color:#961b81;' }, categoryText.toUpperCase());
  const previewSubject = h('h2', { style: 'margin:0 0 16px;font-family:Trebuchet MS,Arial,sans-serif;font-size:24px;line-height:30px;font-weight:bold;font-style:italic;color:#05000b;' }, 'Subject Preview');
  const previewBody = h('div', { style: 'font-family:Arial,sans-serif;font-size:14px;line-height:22px;color:#514a62;' });
  previewBody.innerHTML = '<p style="margin:0 0 12px;color:#888;">Message body preview will appear here...</p>';

  const previewButtonWrap = h('div', { style: 'margin:20px 0 0;', hidden: true });
  const previewButton = h('a', {
    href: '#',
    style: 'display:inline-block;padding:12px 20px;background-color:#e6007e;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;font-family:Trebuchet MS,Arial,sans-serif;font-size:14px;',
  }, 'Action Button');
  previewButtonWrap.appendChild(previewButton);

  const updatePreview = () => {
    previewCategory.textContent = (categoryText || 'COMMUNICATION').toUpperCase();
    previewSubject.textContent = subjectText || 'Subject Preview';
    if (bodyText.trim()) {
      previewBody.innerHTML = markdownToEmailHtml(bodyText);
    } else {
      previewBody.innerHTML = '<p style="margin:0 0 12px;color:#888;">Message body preview will appear here...</p>';
    }
    if (buttonText.trim() && buttonUrl.trim()) {
      previewButton.textContent = `${buttonText.trim()} →`;
      previewButton.setAttribute('href', buttonUrl.trim());
      previewButtonWrap.hidden = false;
    } else {
      previewButtonWrap.hidden = true;
    }
  };

  // History Container
  const historyList = h('tbody');
  const renderHistory = (items: BroadcastEmail[]) => {
    historyList.replaceChildren(
      ...items.map((b) =>
        h('tr', null,
          h('td', null, new Date(b.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })),
          h('td', null, h('strong', null, b.subject)),
          h('td', null, b.audienceType.replace('_', ' ')),
          h('td', null, `${b.recipientCount} recipient${b.recipientCount === 1 ? '' : 's'}`),
          h('td', null, b.senderEmail ?? 'Staff')
        )
      )
    );
  };
  renderHistory(broadcasts);

  // Audience controls
  const panelField = h('div', { class: 'field', hidden: true },
    h('label', { for: 'broadcast-panel' }, 'Select Judging Panel'),
    h('select', { id: 'broadcast-panel', name: 'panel' },
      (Object.keys(PANEL_LABEL) as Panel[]).map((p) => h('option', { value: p }, PANEL_LABEL[p]))
    )
  );

  const specificJudgesField = h('div', { class: 'field', hidden: true },
    h('label', null, 'Choose Specific Judges'),
    h('div', { style: 'max-height:160px;overflow-y:auto;border:1px solid #ccc;border-radius:4px;padding:8px;' },
      judges.length === 0
        ? h('p', { class: 'meta' }, 'No judges registered in this event yet.')
        : judges.map((j) => {
            const cb = h('input', { type: 'checkbox', value: j.userId });
            cb.addEventListener('change', () => {
              if (cb.checked) selectedJudgeIds.add(j.userId);
              else selectedJudgeIds.delete(j.userId);
            });
            return h('label', { style: 'display:flex;gap:8px;margin-bottom:6px;font-size:13px;' },
              cb,
              `${j.name ? `${j.name} · ` : ''}${j.email ?? 'Unknown'} (${j.panel ? PANEL_LABEL[j.panel] : 'General'})`
            );
          })
    )
  );

  const customEmailsField = h('div', { class: 'field', hidden: true },
    h('label', { for: 'broadcast-custom-emails' }, 'Custom Email Addresses'),
    h('textarea', {
      id: 'broadcast-custom-emails',
      name: 'customEmails',
      rows: 3,
      placeholder: 'Enter emails separated by commas or lines, e.g.\njudge@school.edu, team@racing.in',
    })
  );

  panelField.querySelector('select')?.addEventListener('change', (e) => {
    selectedPanel = (e.target as HTMLSelectElement).value as Panel;
  });

  customEmailsField.querySelector('textarea')?.addEventListener('input', (e) => {
    customEmailsText = (e.target as HTMLTextAreaElement).value;
  });

  const audienceSelect = h('select', { id: 'broadcast-audience', name: 'audienceType' },
    h('option', { value: 'all_judges' }, 'All Judges (All Panels)'),
    h('option', { value: 'panel' }, 'Specific Judging Panel'),
    h('option', { value: 'specific_judges' }, 'Specific Individual Judges'),
    h('option', { value: 'emails' }, 'Custom Email IDs')
  );

  audienceSelect.addEventListener('change', () => {
    audienceType = audienceSelect.value as NewBroadcastInput['audienceType'];
    panelField.hidden = audienceType !== 'panel';
    specificJudgesField.hidden = audienceType !== 'specific_judges';
    customEmailsField.hidden = audienceType !== 'emails';
  });

  // Inputs
  const categoryInput = h('input', { type: 'text', name: 'category', value: categoryText });
  categoryInput.addEventListener('input', () => {
    categoryText = categoryInput.value;
    updatePreview();
  });

  const subjectInput = h('input', { type: 'text', name: 'subject', required: true, placeholder: 'e.g. Schedule Update for Finals' });
  subjectInput.addEventListener('input', () => {
    subjectText = subjectInput.value;
    updatePreview();
  });

  const bodyInput = h('textarea', { name: 'body', rows: 8, required: true, placeholder: 'Write your message here...\n\nSupports markdown: **bold**, *italics*, and lists.' });
  bodyInput.addEventListener('input', () => {
    bodyText = bodyInput.value;
    updatePreview();
  });

  const btnTextInput = h('input', { type: 'text', name: 'buttonText', placeholder: 'e.g. Open Schedule' });
  btnTextInput.addEventListener('input', () => {
    buttonText = btnTextInput.value;
    updatePreview();
  });

  const btnUrlInput = h('input', { type: 'url', name: 'buttonUrl', placeholder: 'https://stemracingindia-events.vercel.app/...' });
  btnUrlInput.addEventListener('input', () => {
    buttonUrl = btnUrlInput.value;
    updatePreview();
  });

  const sendLabel = ctx.demo ? 'Simulate announcement' : 'Send announcement';
  const sendBtn = h('button', { type: 'submit', class: 'button' }, sendLabel);

  const form = h('form', { class: 'stack', style: 'flex:1;' },
    h('div', { class: 'field' },
      h('label', { for: 'broadcast-audience' }, 'Audience / Recipients'),
      audienceSelect
    ),
    panelField,
    specificJudgesField,
    customEmailsField,
    h('div', { class: 'field' },
      h('label', null, 'Category Badge'),
      categoryInput
    ),
    h('div', { class: 'field' },
      h('label', null, 'Subject Line *'),
      subjectInput
    ),
    h('div', { class: 'field' },
      h('label', null, 'Message Content * (Supports Markdown)'),
      bodyInput
    ),
    h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;' },
      h('div', { class: 'field' },
        h('label', null, 'Action Button Text (Optional)'),
        btnTextInput
      ),
      h('div', { class: 'field' },
        h('label', null, 'Action Button URL (Optional)'),
        btnUrlInput
      )
    ),
    h('div', { style: 'margin-top:12px;' }, sendBtn)
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    const subject = subjectInput.value.trim();
    const body = bodyInput.value.trim();
    if (!subject) {
      showAlert('Subject line is required');
      return;
    }
    if (!body) {
      showAlert('Message body is required');
      return;
    }

    let customEmails: string[] | undefined;
    if (audienceType === 'emails') {
      customEmails = customEmailsText
        .split(/[\n,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (customEmails.length === 0) {
        showAlert('Please enter at least one recipient email address');
        return;
      }
    }

    if (audienceType === 'specific_judges' && selectedJudgeIds.size === 0) {
      showAlert('Please select at least one judge');
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    try {
      const input: NewBroadcastInput = {
        audienceType,
        panel: audienceType === 'panel' ? selectedPanel : undefined,
        judgeIds: audienceType === 'specific_judges' ? Array.from(selectedJudgeIds) : undefined,
        customEmails,
        category: categoryText.trim() || undefined,
        subject,
        body,
        buttonText: buttonText.trim() || undefined,
        buttonUrl: buttonUrl.trim() || undefined,
      };

      const result = await ctx.api.sendBroadcast(eventId, input);
      showAlert(ctx.demo ? `Announcement simulated for ${result.recipientCount} recipients. No email was sent.` : `Announcement sent successfully to ${result.recipientCount} recipient${result.recipientCount === 1 ? '' : 's'}!`, false);

      // Reset form
      subjectInput.value = '';
      bodyInput.value = '';
      btnTextInput.value = '';
      btnUrlInput.value = '';
      subjectText = '';
      bodyText = '';
      buttonText = '';
      buttonUrl = '';
      updatePreview();

      // Refresh history
      const updated = await ctx.api.listBroadcasts(eventId);
      renderHistory(updated);
    } catch (err: any) {
      showAlert(err.message || 'Failed to send announcement');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = sendLabel;
    }
  });

  // Preview Column
  const previewBox = h('div', {
    'data-role': 'email-preview',
    style: 'flex:1;background:#f3f3f7;border:1px solid #e8e5ed;border-radius:12px;padding:24px;box-sizing:border-box;',
  },
    h('div', { style: 'background:#05000b;border-radius:8px 8px 0 0;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;' },
      h('img', {
        src: 'https://stemracingindia-events.vercel.app/brand/logo-india-colour-white.png',
        alt: 'STEM Racing India',
        style: 'height:40px;width:auto;display:block;',
      }),
      h('div', { style: 'font-family:Trebuchet MS,Arial,sans-serif;font-size:9px;letter-spacing:1.5px;color:#d7d6e3;text-align:right;line-height:14px;' }, 'EVENTS<br>COMMUNICATIONS')
    ),
    h('div', { style: 'display:flex;height:4px;' },
      h('div', { style: 'width:75%;background:#e6007e;' }),
      h('div', { style: 'width:25%;background:#ed6d05;' })
    ),
    h('div', { style: 'background:#ffffff;border-radius:0 0 8px 8px;padding:28px 24px;' },
      previewCategory,
      previewSubject,
      previewBody,
      previewButtonWrap
    ),
    h('div', { style: 'margin-top:16px;text-align:center;font-family:Trebuchet MS,Arial,sans-serif;font-size:9px;letter-spacing:1px;font-weight:bold;color:#666074;' },
      'STEM RACING INDIA / EVENTS PLATFORM'
    )
  );

  // Two Column Layout
  const columns = h('div', { style: 'display:flex;gap:32px;align-items:flex-start;flex-wrap:wrap;' },
    form,
    previewBox
  );
  root.appendChild(columns);

  // Broadcast History Section
  const historyTable = h('table', { class: 'table', 'data-role': 'broadcast-history' },
    h('thead', null,
      h('tr', null,
        h('th', null, 'Sent At'),
        h('th', null, 'Subject'),
        h('th', null, 'Target Audience'),
        h('th', null, 'Recipients'),
        h('th', null, 'Sender')
      )
    ),
    historyList
  );

  const historySection = h('section', { class: 'stack', style: 'margin-top:40px;' },
    h('h2', null, 'Past Broadcasts'),
    historyTable
  );
  root.appendChild(historySection);

  return root;
}
