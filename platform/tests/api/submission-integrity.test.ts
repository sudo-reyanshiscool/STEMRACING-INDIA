import {it,expect,vi,afterEach} from 'vitest';
import {MemoryApi,computeCompulsoryAssetStatus,validateTeamColours,validateMemberPortraits,executeBackgroundRemoval} from '../../src/api';
afterEach(()=>vi.unstubAllGlobals());
it('does not count missing member photos or partial colour sets as complete',()=>{
 expect(computeCompulsoryAssetStatus('e','t',{memberPortraits:[{id:'a',name:'A',role:'Engineer'}],teamColours:{primary:'#FFFFFF'} as any}).missingKeys).toEqual(expect.arrayContaining(['member_portraits','team_colours']));
 expect(()=>validateTeamColours({primary:'',secondary:'',accent:''})).toThrow();
 expect(()=>validateMemberPortraits([{id:'a',name:'A',role:'Engineer'}])).toThrow(/portrait/);
});
it('never fabricates a successful cutout when processing is unavailable or returns invalid output',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
 await expect(executeBackgroundRemoval('anything')).rejects.toMatchObject({code:'network'});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({base64:'bad',width:3840,height:2160})}));
 await expect(executeBackgroundRemoval('anything')).rejects.toMatchObject({code:'network'});
});
it('prevents a manager from reading, modifying or deleting a different team’s media',async()=>{
 const api=new MemoryApi();await api.signIn('reyanshg11111@gmail.com');const e=await api.createEvent({name:'Event'});const a=await api.createTeam(e.id,{number:'1',name:'A'}),b=await api.createTeam(e.id,{number:'2',name:'B'});
 await api.invite(e.id,{email:'manager@test.invalid',role:'team_manager',teamId:a.id});await api.signIn('manager@test.invalid');await api.claimInvitations();
 await expect(api.getBroadcastTeamPhoto(e.id,b.id)).rejects.toMatchObject({code:'forbidden'});
 await expect(api.getCompulsoryAssets(e.id,b.id)).rejects.toMatchObject({code:'forbidden'});
 await expect(api.saveTeamColours(e.id,b.id,{primary:'#fff',secondary:'#000',accent:'#abc'})).rejects.toMatchObject({code:'forbidden'});
 await expect(api.saveTeamMemberPortraits(e.id,b.id,[])).rejects.toMatchObject({code:'forbidden'});
 await expect(api.deleteCompulsoryAsset(e.id,b.id,'team_logo')).rejects.toMatchObject({code:'forbidden'});
});
