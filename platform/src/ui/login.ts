import { ApiError } from '../api';
import { buttonBusy } from './button-busy';
import type { Ctx } from './ctx';
import { codeText, errorText, isPlausibleEmail } from './common';
import { h } from './dom';

/** Who the demo sign-in can enter as. Each opens the sample event in memory; none is a real account. */
const DEMO_ROLES: Array<[label: string, persona: string, sees: string]> = [
  ['Organiser', 'organiser', 'Every page of the event, as organiser and Chair of Judges.'],
  ['Judge', 'judge', 'My scorecards, scores and results, as a Specification judge.'],
  ['Team manager', 'team', 'The team garage, as the manager of team 002.'],
];

function demoSignIn(only: boolean): HTMLElement {
  return h('section', { class: 'demo-login', 'aria-labelledby': 'demo-login-title' },
    h('h3', { id: 'demo-login-title' }, 'Demo sign-in'),
    h('p', { class: 'muted small' }, only
      ? 'Choose who to sign in as. The demo uses sample teams and scores, and nothing you change is saved.'
      : 'No account needed. The demo uses sample teams and scores, and nothing you change is saved.'),
    h('ul', { class: 'demo-login__roles' }, DEMO_ROLES.map(([label, persona, sees]) =>
      h('li', null, h('a', { class: 'demo-login__role', href: `?preview=${persona}#/` },
        h('strong', null, `Sign in as ${label}`), h('span', null, sees))))));
}

export function loginScreen(ctx: Ctx, options: { authError?: string; showCode?: boolean; demo?: boolean; demoOnly?: boolean } = {}): HTMLElement {
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const error = h('p', { class: 'alert', role: 'alert', hidden: !options.authError }, options.authError ?? '');
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', inputmode: 'email' });
  const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send sign-in email');
  const code = h('input', { type: 'text', name: 'code', required: true, autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: 12 });
  const verifyBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Verify code and sign in');
  const codeForm = h('form', { class: 'stack', novalidate: true, 'aria-label': 'Verify email code' },
    h('p', { class: 'muted small' }, 'Use the email address above and the code from your latest email.'),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Verification code'), code), verifyBtn,
  );
  const codeSection = h('details', { class: 'section' }, h('summary', null, 'Have a sign-in code?'), codeForm);
  codeSection.open = options.showCode ?? !!options.authError;
  const password=h('input',{type:'password',name:'password',required:true,autocomplete:'current-password'});
  const passwordBtn=h('button',{class:'btn btn--primary',type:'submit'},'Sign in with password');
  const passwordForm=h('form',{class:'stack',novalidate:true,'aria-label':'Password sign-in'},
    h('p',{class:'muted small'},'Use your private sign-in email above and your password.'),
    h('label',{class:'field'},h('span',{class:'field__label'},'Password'),password),passwordBtn);
  const passwordSection=h('details',{class:'section'},h('summary',null,'Sign in with a password'),passwordForm);
  let busy = false;
  let finishBusy = () => {};
  const setBusy = (value: boolean, button = submitBtn, label = 'Sending email…') => {
    busy = value;
    if (value) finishBusy = buttonBusy(button, label);
    else finishBusy();
    submitBtn.disabled = value; verifyBtn.disabled = value; passwordBtn.disabled=value;
  };
  const validEmail = () => {
    if (isPlausibleEmail(email.value)) return true;
    error.textContent = 'Enter a valid email address, for example name@school.org.'; error.hidden = false; return false;
  };
  const form = h('form', { class: 'stack', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Email address'), email), submitBtn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    error.hidden = true; notice.hidden = true;
    if (!validEmail()) return;
    const address = email.value.trim().toLowerCase();
    if(address.endsWith('.invalid')) {
      passwordSection.open=true;codeSection.open=false;
      error.textContent='This address cannot receive email. Use password sign-in below.';error.hidden=false;password.focus();return;
    }
    setBusy(true);
    try {
      await ctx.api.signIn(address);
      if (await ctx.api.getSession()) ctx.rerender();
      else {
        notice.textContent = `We sent a sign-in email to ${address}. Open its link and confirm, or enter the code below. Use the newest email; older links may no longer work.`;
        notice.hidden = false; codeSection.open = true;
      }
    } catch (err) { error.textContent = errorText(err); error.hidden = false; }
    finally { setBusy(false); }
  });
  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    error.hidden = true; notice.hidden = true;
    if (!validEmail()) return;
    const token = code.value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) {
      error.textContent = 'Enter the verification code from your latest email (6–10 digits).'; error.hidden = false; return;
    }
    setBusy(true, verifyBtn, 'Verifying…');
    try {
      await ctx.flush();
      await ctx.api.verifyEmailCode(email.value.trim().toLowerCase(), token);
      code.value = '';
      ctx.rerender();
    } catch (err) { error.textContent = errorText(err); error.hidden = false; }
    finally { setBusy(false); }
  });
  passwordForm.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    error.hidden=true;notice.hidden=true;
    if(!validEmail())return;
    if(!password.value){error.textContent='Enter your password.';error.hidden=false;return;}
    const address=email.value.trim().toLowerCase();const secret=password.value;
    setBusy(true,passwordBtn,'Signing in…');
    try{
      await ctx.flush();
      await ctx.api.signInWithPassword(address,secret);
      password.value='';ctx.rerender();
    }catch(err){
      error.textContent=err instanceof ApiError&&err.code==='invalid-auth'?'Could not sign in. Check your private sign-in email and password.':err instanceof ApiError&&err.code==='rate-limited'?'Too many sign-in attempts. Please wait a minute and try again.':errorText(err);
      error.hidden=false;
    }finally{password.value='';setBusy(false);}
  });
  const waiting = ctx.queue.status().pending;
  return h('div', { class: 'login-screen' },
    h('section', { class: 'login-hero' },
      h('h1', null, 'Judging, racing and results.'),
      h('p', { class: 'lead' }, 'The STEM Racing India events platform, for every Regional and National Final.')),
    h('div', { class: 'login-panel' },
      h('div', { class: 'stack' },
        h('h2', null, 'Sign in'),
        options.demoOnly ? null : h('p', { class: 'lead' }, 'Use the email address your event organiser invited.')),
      waiting > 0
        ? h('p', { class: 'notice' }, `${codeText('unauthenticated')}. ${waiting} score${waiting === 1 ? ' is' : 's are'} waiting on this device and will be sent once you are signed in.`)
        : null,
      // In the demo there is no real account to sign in to, so the role choices replace the email forms.
      ...(options.demoOnly ? [demoSignIn(true)] : [notice, error, form, codeSection, passwordSection, options.demo ? demoSignIn(false) : null]),
      options.demoOnly ? null : h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, 'Final standings are public. Detailed scores and feedback are private to signed-in team managers.'),
        h('p', { class: 'muted small' }, 'Supports email sign-in codes and two-factor authentication via authenticator apps (TOTP).'))),
  );
}
