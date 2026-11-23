import {eventDisplayName,normaliseCity,type EventRow} from '../api';
import {reportActionError} from './actions';
import {buttonBusy} from './button-busy';
import type {Ctx} from './ctx';
import {h} from './dom';

/** Organisers and Chairs rename an event from its parts (city, number, year) or with a custom name. The level is fixed. */
export function renameEventControl(ctx:Ctx,event:EventRow):HTMLElement{
  let alive=true,busy=false;
  ctx.onLeave(()=>{alive=false;});
  const level=event.competitionLevel;
  const open=h('button',{class:'btn btn--ghost',type:'button','aria-expanded':'false'},'Rename event');
  const city=h('input',{name:'city',maxlength:60,autocomplete:'address-level2',value:event.city??''});
  const year=h('input',{name:'year',type:'number',min:2000,max:2100,step:1,inputmode:'numeric',value:event.year??(event.startsOn?Number(event.startsOn.slice(0,4)):new Date().getFullYear())});
  const number=h('input',{name:'number',type:'number',min:1,max:99,step:1,inputmode:'numeric',placeholder:event.regionalNumber?`Automatic (now ${event.regionalNumber})`:'Automatic'});
  const custom=h('input',{type:'checkbox',name:'custom',checked:!level||!!event.customName,disabled:!level});
  const customName=h('input',{name:'name',maxlength:120,autocomplete:'off',value:event.name});
  const preview=h('p',{class:'small','aria-live':'polite'});
  const error=h('p',{class:'alert',role:'alert',hidden:true});
  const save=h('button',{class:'btn btn--primary',type:'submit'},'Save name');
  const cancel=h('button',{class:'btn btn--ghost',type:'button'},'Cancel');
  const parts=h('div',{class:'stack'},
    h('label',{class:'field'},h('span',{class:'field__label'},'City'),city),
    level==='regional'?h('label',{class:'field'},h('span',{class:'field__label'},'Regional number'),number,h('span',{class:'small muted'},'Leave blank to keep the current number, or to take the next free number for a new city or year.')):null,
    h('label',{class:'field'},h('span',{class:'field__label'},'Year'),year));
  const customField=h('label',{class:'field'},h('span',{class:'field__label'},'Custom event name'),customName);
  const refresh=()=>{
    parts.hidden=custom.checked;customField.hidden=!custom.checked;
    if(custom.checked){preview.textContent=`New name: ${normaliseCity(customName.value)||'…'}`;return;}
    const n=number.value?Number(number.value):event.city&&normaliseCity(event.city).toLowerCase()===normaliseCity(city.value).toLowerCase()&&event.year===Number(year.value)?event.regionalNumber:null;
    preview.textContent=normaliseCity(city.value)&&level?`New name: ${eventDisplayName(level,city.value,Number(year.value),n??'(next free number)')}`:'Enter the city to see the new name.';
  };
  [city,year,number,customName].forEach(i=>i.addEventListener('input',refresh));custom.addEventListener('change',refresh);
  const form=h('form',{class:'stack',hidden:true,novalidate:true},
    level?h('p',{class:'small muted'},`This is a ${level==='regional'?'Regionals':'Nationals'} event. The level is set when the event is created.`):h('p',{class:'small muted'},'This event was created before automatic names, so it can only take a custom name.'),
    h('label',{class:'checkbox'},custom,' Use a custom name'),customField,parts,preview,error,h('div',{class:'actions'},save,cancel));
  refresh();
  open.addEventListener('click',()=>{form.hidden=false;open.hidden=true;open.setAttribute('aria-expanded','true');(custom.checked?customName:city).focus();});
  cancel.addEventListener('click',()=>{if(busy)return;form.hidden=true;open.hidden=false;open.setAttribute('aria-expanded','false');error.hidden=true;open.focus();});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;error.hidden=true;
    if(custom.checked&&!customName.value.trim()){error.textContent='Enter the event name.';error.hidden=false;customName.focus();return;}
    if(!custom.checked&&!normaliseCity(city.value)){error.textContent='Enter the city.';error.hidden=false;city.focus();return;}
    busy=true;const finish=buttonBusy(save,'Saving…');
    try{
      await ctx.api.renameEvent(event.id,{city:city.value.trim()||null,year:year.value?Number(year.value):null,regionalNumber:number.value?Number(number.value):null,customName:custom.checked?customName.value:null});
      if(alive)ctx.rerender();
    }catch(err){if(alive)reportActionError(ctx,error,err,{forbidden:'Only an organiser or Chair of this event can rename it.'});}
    finally{busy=false;finish();}
  });
  return h('section',{class:'section event-rename','aria-label':'Rename event'},h('h2',null,'Event name'),h('p',null,h('strong',null,event.name)),open,form);
}
