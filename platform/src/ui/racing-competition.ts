import type { TeamRow } from '../api';
import { blankLane, raceStandings, seconds, type RaceHeat } from '../racing';
import { defaultReactionScoring, adjustedTime, carCheck, competitionScores, POINT_NAMES, ROUND_NAMES, type RacingSetup } from '../racing/competition';
import { openArenaPairingModal } from './broadcast-modal';
import type { Inspection } from '../technical';
import type { Ctx } from './ctx';
import { h } from './dom';

interface State { teams: TeamRow[]; races: RaceHeat[]; inspections: Inspection[]; setup: RacingSetup }
/** No local-only progression: rebuild every match from the shared seeds, inspections and recorded heats. */
export function competitionPanel(ctx: Ctx, eventId: string, get:()=>State, select:(r:RaceHeat)=>void, refresh:()=>Promise<void>, fail:(e:unknown)=>void, canConfigure:boolean, canRecord:boolean) {
  const root=h('section',{class:'section stack race-competition','aria-label':'Competition racing setup'});
  let signature='', busy=false;
  const field=(label:string,c:HTMLElement)=>h('label',{class:'field'},h('span',{class:'field__label'},label),c);
  const run=async(button:HTMLButtonElement, action:()=>Promise<unknown>)=>{if(busy)return;busy=true;button.disabled=true;try{await action();await refresh();}catch(e){fail(e);}finally{busy=false;signature='';render();}};
  function render() {
    const {teams,races,inspections,setup}=get();
    const next=JSON.stringify({setup,races,inspections});if(signature===next || busy)return;signature=next;
    const name=(id:string|null)=>{const t=teams.find(t=>t.id===id);return t?`#${t.number} ${t.name}`:'—';};
    const scores=competitionScores(teams.map(t=>t.id),races,inspections,setup);
    const section=h('div',{class:'stack'},h('h2',null,'Competition racing'),h('p',{class:'small muted'},'Top 64 qualify. PERF or SAF failures on either car eliminate a team in the first knockout round, including a bye. Knockout totals add 0.200 s per failed PERF regulation and 0.300 s per failed SAF regulation on the nominated car. Reaction times stay unchanged. Specification point deductions remain.'));
    const setupBox=h('details',{open:!setup.seeds.length},h('summary',null,'Racing setup and stage points'));
    const form=h('form',{class:'stack'});
    const complete=h('input',{type:'checkbox',checked:setup.reactionComplete,disabled:!canConfigure||races.some(r=>r.bracket)});
    const points=setup.points.map((p,i)=>h('input',{type:'number',min:0,max:135,step:0.1,value:p??'',disabled:!canConfigure,'aria-label':POINT_NAMES[i]}));
    const scoring=setup.scoring??defaultReactionScoring();
    const scoreValues=[...scoring.podium,scoring.minimum,scoring.referenceMultiplier,scoring.falseStartPenalty,scoring.dnfPenalty,scoring.fastestCarBonus];
    const scoreNames=['Reaction first place','Reaction second place','Reaction third place','Minimum reaction points','Reference multiplier','False-start deduction','DNF deduction at minimum score','Fastest Car bonus'];
    const scoreInputs=scoreValues.map((value,i)=>h('input',{type:'number',value,min:i===4?1.01:0,max:i===4?10:i===7?10:105,step:i===4?0.01:0.1,required:true,disabled:!canConfigure,'aria-label':scoreNames[i]}));
    const save=h('button',{type:'submit',class:'btn',disabled:!canConfigure},'Save racing setup');
    form.append(h('label',{class:'inline'},complete,' Reaction racing complete'),h('p',{class:'small muted'},'Confirm only after all reaction runs have been entered. Four runs per team: Car A and Car B in each lane. Once knockout heats are queued, reaction results and seed order lock.'),h('div',{class:'grid'},points.map((p,i)=>field(POINT_NAMES[i],p))),h('h3',null,'Reaction racing and Fastest Car scoring'),h('div',{class:'grid'},scoreInputs.map((p,i)=>field(scoreNames[i],p))),h('p',{class:'small muted'},'Review these values with Shubham before competition use. Defaults come from the pinned 2026 rules; the meeting did not finalise 2027 scoring.'),h('p',{class:'small muted'},'The supplied regulations do not define a complete top-64 points table. Fill the blank stages before final results can be released. Blank values remain pending.'),save);
    form.addEventListener('submit',e=>{e.preventDefault();void run(save,()=>ctx.api.saveRacingSetup(eventId,setup.revision,{seeds:complete.checked?setup.seeds:[],reactionComplete:complete.checked,points:points.map(p=>p.value===''?null:Number(p.value)),scoring:{podium:[Number(scoreInputs[0].value),Number(scoreInputs[1].value),Number(scoreInputs[2].value)],minimum:Number(scoreInputs[3].value),referenceMultiplier:Number(scoreInputs[4].value),falseStartPenalty:Number(scoreInputs[5].value),dnfPenalty:Number(scoreInputs[6].value),fastestCarBonus:Number(scoreInputs[7].value)}}));});
    setupBox.append(form);section.append(setupBox);
    const scheduleActions = h('div', { class: 'actions' });
    if(canConfigure&&!races.some(r=>r.phase==='reaction')) {
      const queue=h('button',{type:'button',class:'btn btn--ghost',disabled:teams.length<1},'Queue four reaction runs per team');
      queue.onclick=()=>void run(queue,()=>ctx.api.queueReactionRaces(eventId));scheduleActions.append(queue);
    }
    if(races.some(r=>r.phase==='reaction')) {
      const downloadReactionPdf = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Download reaction heats PDF');
      downloadReactionPdf.onclick = async () => {
        downloadReactionPdf.disabled = true;
        try {
          const { buildHeatsPdf, heatsFileName } = await import('../pdf/heatsPdf');
          const doc = buildHeatsPdf({
            eventName: 'STEM Racing Regional Finals',
            teams,
            races,
            phase: 'reaction',
          });
          doc.save(heatsFileName('STEM-Racing-Regional-Finals', 'reaction'));
        } catch (e) {
          fail(e);
        } finally {
          downloadReactionPdf.disabled = false;
        }
      };
      scheduleActions.append(downloadReactionPdf);
    }
    if(races.some(r=>r.phase==='knockout')) {
      const downloadKnockoutPdf = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Download knockout heats PDF');
      downloadKnockoutPdf.onclick = async () => {
        downloadKnockoutPdf.disabled = true;
        try {
          const { buildHeatsPdf, heatsFileName } = await import('../pdf/heatsPdf');
          const doc = buildHeatsPdf({
            eventName: 'STEM Racing Regional Finals',
            teams,
            races,
            phase: 'knockout',
          });
          doc.save(heatsFileName('STEM-Racing-Regional-Finals', 'knockout'));
        } catch (e) {
          fail(e);
        } finally {
          downloadKnockoutPdf.disabled = false;
        }
      };
      scheduleActions.append(downloadKnockoutPdf);
    }
    if(scheduleActions.childNodes.length) section.append(scheduleActions);
    if(!setup.seeds.length) {
      const candidates=raceStandings(races).filter(t=>t.totalMs!==null);
      const tie=candidates.some((t,i)=>i>0&&i<=64&&t.totalMs===candidates[i-1].totalMs);
      const approve=h('button',{type:'button',class:'btn',disabled:!canConfigure||!setup.reactionComplete||candidates.length<2||tie},'Approve knockout seeds');
      const acknowledged=h('input',{type:'checkbox',disabled:!canConfigure});
      acknowledged.onchange=()=>{approve.disabled=!canConfigure||!setup.reactionComplete||candidates.length<2||(tie&&!acknowledged.checked);};
      const list=h('ol'), preview=h('details',null,h('summary',null,`Preview top-64 seeds · ${candidates.length} finishers`),list);
      const drawSeeds=()=>{list.replaceChildren(...candidates.map((t,i)=>{
        const row=h('li',null,`${name(t.teamId)} · ${seconds(t.totalMs)} s${i>=64?' · outside top 64':''}`);
        if(canConfigure&&tie)for(const direction of [-1,1]) {
          const other=candidates[i+direction];
          if(!other||other.totalMs!==t.totalMs)continue;
          const move=h('button',{type:'button',class:'btn btn--ghost','aria-label':`Move ${name(t.teamId)} ${direction<0?'up':'down'} in tied seeds`},direction<0?'Move up':'Move down');
          move.onclick=()=>{[candidates[i],candidates[i+direction]]=[candidates[i+direction],candidates[i]];acknowledged.checked=false;approve.disabled=true;drawSeeds();};row.append(move);
        }
        return row;
      }));};drawSeeds();
      approve.onclick=()=>void run(approve,()=>ctx.api.saveRacingSetup(eventId,setup.revision,{...setup,seeds:candidates.slice(0,64).map(t=>t.teamId)}));
      section.append(preview);
      if(tie)section.append(h('label',{class:'notice'},acknowledged,' I have resolved equal qualifying times and approve the displayed seed order, including the qualification cutoff. Move tied teams within the preview as needed.'));
      section.append(approve);
    } else {
      section.append(h('h3',null,`Knockout bracket · ${setup.seeds.length} seeds`));
      for(let round=1;round<=6;round++) {
        const matches=scores.bracket.filter(m=>m.round===round);
        const group=h('details',{open:matches.some(m=>m.team1&&m.team2&&!m.resolved)},h('summary',null,`${ROUND_NAMES[round-1]} · ${matches.filter(m=>m.resolved).length}/${matches.length} settled`));
        const rows=matches.filter(m=>m.team1||m.team2||m.reason!=='Empty bracket slot').map(m=>{
          const label=`KR-H${String(m.slot).padStart(2, '0')} · ${ROUND_NAMES[round-1]}`;
          const node=h('article',{class:'row stack'},h('strong',null,`${m.slot}. ${name(m.team1)} / ${name(m.team2)}`),h('span',{class:'small'},m.reason),m.winner?h('span',{class:'tag tag--pass'},`Advances: ${name(m.winner)}`):null);
          if(m.disqualified.length)node.append(h('p',{class:'alert'},`Disqualified: ${m.disqualified.map(id=>`${name(id)} (${(['A','B'] as const).flatMap(car=>{const c=carCheck(inspections,id,car);return [...c.performance.map(a=>`Car ${car} PERF ${a}`),...c.safety.map(a=>`Car ${car} SAF ${a}`)];}).join(', ')})`).join('; ')}`));
          if(m.heat) {
            for(const l of [m.heat.lane1,m.heat.lane2]) {
              const check=carCheck(inspections,l.teamId,l.car);
              node.append(h('p',{class:'small'},`${name(l.teamId)} · Car ${l.car}: raw ${seconds(l.totalMs)} s + ${check.ready?seconds(check.additionMs):'pending inspection'} s = ${seconds(adjustedTime(m.heat,l,inspections))} s`));
            }
            const open=h('button',{class:'btn btn--ghost',type:'button'},'Open heat');open.onclick=()=>select(m.heat!);node.append(open);
          }
          if(canRecord&&!m.resolved&&m.team1&&m.team2&&(m.reason==='Ready to race'||m.reason.includes('rerun required')||m.reason.startsWith('Pairing changed'))) {
            const queue=h('button',{class:'btn',type:'button'},m.heat?'Queue rerun':'Queue match');
            queue.onclick=()=>void run(queue,async()=>{const replace=m.reason.startsWith('Pairing changed')&&m.heat&&(m.heat.lane1.status==='pending'||m.heat.lane2.status==='pending')?m.heat:null;const row=m.heat && !replace ? await ctx.api.queueRaceFollowup(eventId,m.heat.id,m.heat.revision,'rerun') : await ctx.api.saveRace(eventId,replace?.id??crypto.randomUUID(),replace?.revision??0,{label,phase:'knockout',bracket:{round,slot:m.slot},lane1:blankLane(m.team1!),lane2:blankLane(m.team2!),note:replace?'Pairing repaired after the previous round changed':'',source:'manual',sourceRunId:null});await refresh();select(row);});node.append(queue);
          }
          if(m.team1&&m.team2) {
            const arena=h('button',{class:'btn btn--ghost',type:'button'},'Arena screen');
            arena.onclick=()=>void openArenaPairingModal(ctx,eventId,m.team1!,m.team2!,{roundName:ROUND_NAMES[round-1],label,winnerId:m.winner});
            node.append(arena);
          }
          return node;
        });group.append(h('div',{class:'stack'},rows));section.append(group);
      }
    }
    if(scores.issues.length)section.append(h('p',{class:'notice'},scores.issues.join(' ')));
    const board=h('table',{class:'table'},h('thead',null,h('tr',null,['Team','Reaction / 105','Knockout / 135','Fastest car / 10','Race deductions'].map(s=>h('th',{scope:'col'},s)))),h('tbody',null,teams.map(t=>h('tr',null,h('th',{scope:'row'},name(t.id)),...['reaction','knockout','fastest-car'].map(id=>h('td',{class:'num'},scores.derived[t.id]?.[id]??'Pending')),h('td',{class:'num'},scores.penalties.find(p=>p.teamId===t.id)?.points??0)))));
    section.append(h('details',null,h('summary',null,'Racing points'),h('div',{class:'table-wrap'},board)));root.replaceChildren(section);
  }
  return {root,render};
}
