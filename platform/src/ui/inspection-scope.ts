import type { Ctx } from './ctx';
import { INDIA_TECHNICAL, SECTIONS } from '../technical';
import { h } from './dom';
import { errorText } from './common';
export async function inspectionScopeControl(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const scope=await ctx.api.getInspectionScope(eventId);
  const all=h('input',{type:'checkbox',checked:scope.articles===null,disabled:scope.locked});
  const inputs=new Map<string,HTMLInputElement>();
  const groups=SECTIONS.map(section=>h('fieldset',{class:'stack'},h('legend',null,section.title),INDIA_TECHNICAL.rules.filter(r=>r.section===section.id).map(r=>{
    const input=h('input',{type:'checkbox',checked:scope.articles===null||scope.articles.includes(r.article),disabled:scope.locked||all.checked});inputs.set(r.article,input);
    return h('label',null,input,` ${r.article} · ${r.name}`);
  })));
  all.onchange=()=>inputs.forEach(input=>{input.disabled=scope.locked||all.checked;});
  const status=h('p',{role:'status'});
  const save=h('button',{type:'submit',class:'btn',disabled:scope.locked},'Save inspection scope');
  const form=h('form',{class:'stack',onsubmit:async(e:Event)=>{
    e.preventDefault();if(save.disabled)return;
    const articles=all.checked?null:[...inputs].filter(([,i])=>i.checked).map(([a])=>a);
    if(articles?.length===0){status.textContent='Select at least one regulation.';return;}
    save.disabled=true;
    try{await ctx.api.saveInspectionScope(eventId,scope.revision,articles);ctx.rerender();}
    catch(err){status.textContent=errorText(err);save.disabled=false;}
  }},h('p',null,scope.locked?'The checklist is pinned because inspections have started.':'Choose the same inspection checklist for every team before inspections begin. Unselected regulations do not create penalties or block completion.'),h('label',null,all,' Full technical checklist'),groups,status,save);
  return h('details',{class:'section'},h('summary',null,'Scrutineering setup'),form);
}
