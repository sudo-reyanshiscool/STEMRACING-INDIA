import {ApiError,EVENT_LOGO_SLOTS,EVENT_NAME_PREFIX,MAX_BATCH_EVENTS,previewBatchNames,validateEventLogos,validateNamedEvent,type CompetitionLevel,type EventLogos,type EventRow,type NamedEventInput} from '../api';
import {readEventLogo} from './event-branding';
import {buttonBusy} from './button-busy';
import {reportActionError} from './actions';
import type {Ctx} from './ctx';
import {h} from './dom';
import {routeHref} from './router';

const today=()=>new Date().toISOString().slice(0,10);
interface Row {city:HTMLInputElement;cityField:HTMLElement;date:HTMLInputElement;title:HTMLElement;preview:HTMLElement;el:HTMLElement}

/**
 * Creates one or more events named "STEM Racing India <City> Regionals <n> <Year>" or "... <City> Nationals <Year>".
 * Regional numbers count per city and year; the server assigns the final numbers, so the preview is a guide.
 * A custom name is still available for one-off events such as a test event.
 */
export function newEventsForm(ctx:Ctx,events:readonly EventRow[],isAlive:()=>boolean):HTMLElement{
  const error=h('p',{class:'alert',role:'alert',hidden:true});
  const status=h('p',{class:'notice',role:'status',hidden:true});
  const submitBtn=h('button',{class:'btn btn--primary',type:'submit'},'Create event');
  const level=h('select',{name:'level','aria-label':'Competition level'},h('option',{value:'regional'},'Regionals'),h('option',{value:'national'},'Nationals'));
  const year=h('input',{name:'year',type:'number',min:2000,max:2100,step:1,inputmode:'numeric',value:new Date().getFullYear(),'aria-label':'Year',class:'input--short'});
  const count=h('select',{name:'count','aria-label':'How many regionals'},Array.from({length:MAX_BATCH_EVENTS},(_,i)=>h('option',{value:i+1},String(i+1))));
  const countField=h('label',{class:'field'},h('span',{class:'field__label'},'How many regionals?'),count);
  const custom=h('input',{type:'checkbox',name:'custom'});
  const customName=h('input',{name:'name',maxlength:120,autocomplete:'off','aria-label':'Custom event name'});
  const customField=h('label',{class:'field form__wide',hidden:true},h('span',{class:'field__label'},'Custom event name'),customName,h('span',{class:'small muted'},'For one-off events, such as a test event. You can switch it back to the automatic name later.'));
  const regionalPreview=h('div',{class:'event-logo-preview event-logo-preview--dark'},h('img',{src:'/brand/logo-regional-finals-white.png',alt:'Regional finals logo'}));
  const slots=EVENT_LOGO_SLOTS.map(slot=>({...slot,input:h('input',{type:'file',accept:'.png,image/png','aria-label':`Nationals ${slot.label} logo`}),preview:h('div',{class:`event-logo-preview ${slot.dark?'event-logo-preview--dark':''}`},h('span',{class:'muted'},`${slot.dark?'Dark':'Light'} background preview`))}));
  const nationals=h('fieldset',{class:'event-logo-set stack',hidden:true},h('legend',null,'This event’s nationals logos'),h('p',{class:'muted small'},'PNG files, up to 2 MB each. Upload all four versions: two monochrome and two full-colour. This set belongs to this event.'),h('div',{class:'event-logo-set__slots'},slots.map(slot=>h('label',{class:'field'},slot.label,slot.input,slot.preview))));
  slots.forEach(slot=>{let request=0;slot.input.onchange=async()=>{const current=++request;const file=slot.input.files?.[0];slot.preview.replaceChildren();if(!file)return;try{const logo=await readEventLogo(file);validateEventLogos({light:logo,dark:logo,monoBlack:logo,monoWhite:logo});if(current===request)slot.preview.append(h('img',{src:`data:image/png;base64,${logo.base64}`,alt:`Nationals ${slot.label} logo preview`}));}catch(err){if(current===request)slot.preview.append(h('span',{class:'alert'},err instanceof Error?err.message:'Check the logo file.'));}};});

  const rows:Row[]=[];
  const rowList=h('ol',{class:'event-batch stack'});
  const makeRow=():Row=>{
    const city=h('input',{name:'city',maxlength:60,autocomplete:'address-level2',required:true});
    const date=h('input',{name:'date',type:'date',value:today()});
    const preview=h('p',{class:'event-batch__name small'});
    const cityField=h('label',{class:'field'},h('span',{class:'field__label'},'City'),city);
    const title=h('p',{class:'event-batch__title eyebrow'});
    const el=h('li',{class:'event-batch__row'},title,cityField,h('label',{class:'field'},h('span',{class:'field__label'},'Date'),date),preview);
    city.addEventListener('input',refresh);
    return {city,cityField,date,title,preview,el};
  };
  const wanted=()=>custom.checked||level.value==='national'?1:Number(count.value);
  function syncRows(){
    while(rows.length<wanted())rows.push(makeRow());
    rowList.replaceChildren(...rows.slice(0,wanted()).map((r,i)=>{const label=custom.checked?'Date':level.value==='regional'&&wanted()>1?`Regional ${i+1}`:level.value==='regional'?'Regional':'Nationals';r.el.setAttribute('aria-label',label);r.title.textContent=label;return r.el;}));
  }
  function drafts():NamedEventInput[]{return rows.slice(0,wanted()).map(r=>({level:level.value as CompetitionLevel,city:r.city.value,year:Number(year.value),...(r.date.value?{startsOn:r.date.value}:{})}));}
  function refresh(){
    const isCustom=custom.checked,national=level.value==='national';
    countField.hidden=national||isCustom;customField.hidden=!isCustom;
    nationals.hidden=!national;regionalPreview.hidden=national;
    syncRows();
    const names=previewBatchNames(events,drafts());
    rows.slice(0,wanted()).forEach((r,i)=>{r.cityField.hidden=isCustom;r.preview.hidden=isCustom;r.preview.textContent=names[i]??`${EVENT_NAME_PREFIX} … enter the city to see the name`;});
    submitBtn.textContent=wanted()>1?`Create ${wanted()} events`:'Create event';
  }
  level.addEventListener('change',refresh);count.addEventListener('change',refresh);year.addEventListener('input',refresh);custom.addEventListener('change',refresh);

  const form=h('form',{class:'form',novalidate:true},
    h('p',{class:'field'},h('span',{class:'field__label'},'Name starts with'),h('strong',null,EVENT_NAME_PREFIX)),
    h('label',{class:'field'},h('span',{class:'field__label'},'Competition level'),level),
    h('label',{class:'field'},h('span',{class:'field__label'},'Year'),year),
    countField,rowList,
    h('label',{class:'checkbox form__wide'},custom,' Use a custom name instead'),customField,
    h('p',{class:'small muted form__wide'},'Regional numbers count separately for each city and year, so a second Delhi regional becomes Delhi Regionals 2. The final number is confirmed when the event is created.'),
    regionalPreview,nationals,submitBtn,
  );
  refresh();

  let busy=false;
  const show=(message:string)=>{error.textContent=message;error.hidden=false;};
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    error.hidden=true;status.hidden=true;
    const competitionLevel=level.value as CompetitionLevel;
    const items=drafts();
    if(custom.checked){if(!customName.value.trim())return show('Event name is required.');}
    else for(const [i,item] of items.entries()){const problem=validateNamedEvent(item);if(problem){rows[i]!.city.focus();return show(items.length>1?`Regional ${i+1}: ${problem}`:problem);}}
    busy=true;const finish=buttonBusy(submitBtn,wanted()>1?'Creating events…':'Creating event…');
    try{
      let logos:EventLogos|undefined;
      if(competitionLevel==='national'){const files=slots.map(s=>({key:s.key,file:s.input.files?.[0]}));if(files.some(s=>!s.file))throw new Error('Upload all four nationals logos: monochrome black, monochrome white, full colour with white text, and full colour with black text.');const uploads=await Promise.all(files.map(async s=>[s.key,await readEventLogo(s.file!)] as const));logos=validateEventLogos(Object.fromEntries(uploads) as unknown as EventLogos);}
      const made=custom.checked
        ?[await ctx.api.createEvent({name:customName.value,startsOn:rows[0]!.date.value||undefined,competitionLevel,logos})]
        :await ctx.api.createEvents(items.map(i=>({...i,...(logos?{logos}:{})})));
      if(!isAlive())return;
      if(made.length===1){location.hash=routeHref({name:'event',eventId:made[0]!.id});return;}
      ctx.rerender();
    }catch(err){
      if(!isAlive())return;
      if(err instanceof Error&&!(err instanceof ApiError))show(err.message);else reportActionError(ctx,error,err);
    }finally{busy=false;finish();}
  });
  return h('div',{class:'stack'},error,status,form);
}
