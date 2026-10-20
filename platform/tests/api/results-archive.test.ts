import {beforeEach,describe,expect,it,vi} from 'vitest';
import {unzipSync,strFromU8,strToU8} from 'fflate';
import type {ResultsPacket} from '../../src/api/result-mail';
vi.mock('../../src/pdf/resultReports',()=>({
 buildStandingsPdf:vi.fn(()=>({output:()=>strToU8('%PDF standings').buffer})),
 teamResultPdfFiles:vi.fn((p:ResultsPacket)=>[
  {filename:'Results.pdf',bytes:strToU8(`%PDF results ${p.team.id}`)},
  {filename:'Feedback.pdf',bytes:strToU8(`%PDF feedback ${p.team.id}`)},
 ]),
}));
import {ArchiveCancelled,buildResultsArchive} from '../../src/pdf/resultsArchive';
import {buildStandingsPdf} from '../../src/pdf/resultReports';
const event={id:'event',name:'National / Finals',snapshotId:'snapshot'};
const teams=[{id:'one',number:'1/',name:'Same / Name'},{id:'two',number:'1-',name:'Same - Name'}];
const packet=(id:string)=>({eventId:event.id,snapshotId:event.snapshotId,eventName:event.name,team:{id},standings:[],awards:[],released:false,awardsConfirmed:false}) as unknown as ResultsPacket;
const options=()=>({cancelled:()=>false,progress:vi.fn()});
beforeEach(()=>vi.clearAllMocks());
describe('all results PDF archive',()=>{
 it('includes common standings once and both PDFs per team, preserving distinct team contents',async()=>{
  const opts=options(),load=vi.fn(async(id:string)=>packet(id));
  const archive=await buildResultsArchive(event,teams,load,opts);
  const entries=unzipSync(archive.bytes),paths=Object.keys(entries);
  expect(archive.filename).toBe('National-Finals-All-Results-PDFs.zip');
  expect(archive.count).toBe(5);expect(paths).toHaveLength(5);
  expect(buildStandingsPdf).toHaveBeenCalledOnce();
  expect(paths.filter(p=>p.endsWith('Results.pdf'))).toHaveLength(2);
  expect(paths.filter(p=>p.endsWith('Feedback.pdf'))).toHaveLength(2);
  expect(paths.every(p=>!p.includes('..'))).toBe(true);
  expect(paths.filter(p=>p.includes('001-'))).toHaveLength(2);
  expect(paths.filter(p=>p.includes('002-'))).toHaveLength(2);
  expect(paths.map(p=>strFromU8(entries[p]))).toEqual(expect.arrayContaining(['%PDF results one','%PDF feedback one','%PDF results two','%PDF feedback two']));
  expect(opts.progress).toHaveBeenLastCalledWith(2,2);
 });
 it('aborts instead of offering a partial archive when another team cannot be loaded',async()=>{
  await expect(buildResultsArchive(event,teams,async id=>{if(id==='two')throw new Error('Access denied');return packet(id);},options())).rejects.toThrow('Access denied');
 });
 it('rejects another team or snapshot and changes to shared awards during preparation',async()=>{
  await expect(buildResultsArchive(event,teams,async()=>packet('wrong-team'),options())).rejects.toThrow('changed');
  await expect(buildResultsArchive(event,teams,async id=>({...packet(id),snapshotId:'new'}),options())).rejects.toThrow('changed');
  await expect(buildResultsArchive(event,teams,async id=>({...packet(id),awards:id==='two'?[{title:'Best',teamNumber:'1',teamName:'One'}]:[]}),options())).rejects.toThrow('changed');
 });
 it('cancels during loading without loading more teams',async()=>{
  let cancelled=false;const load=vi.fn(async(id:string)=>{cancelled=true;return packet(id);});
  await expect(buildResultsArchive(event,teams,load,{...options(),cancelled:()=>cancelled})).rejects.toBeInstanceOf(ArchiveCancelled);
  expect(load).toHaveBeenCalledOnce();expect(buildStandingsPdf).not.toHaveBeenCalled();
 });
});
